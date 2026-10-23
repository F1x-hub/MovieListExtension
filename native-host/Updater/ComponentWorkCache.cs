using System.Diagnostics;
using System.Text.Json;

// Only direct GUID work directories are candidates. Unknown content and aliases fail closed.
public static class ComponentWorkCache
{
    private static bool GuidName(string name) => Guid.TryParseExact(name, "D", out var id) && id.ToString("D") == name;

    public static void Prune(string root, IEnumerable<string> retainedIds, DateTimeOffset now)
    {
        try
        {
            if (!Directory.Exists(root) || !SafeAncestors(root)) return;
            var retained = new HashSet<string>(retainedIds.Where(GuidName), StringComparer.OrdinalIgnoreCase);
            foreach (var process in Process.GetProcessesByName("worker"))
            {
                using (process)
                {
                    string? executable;
                    try { executable = process.MainModule?.FileName; }
                    // An unrelated privileged process must not disable all cache cleanup.
                    // The authoritative operation ID and pending/recovery journals remain
                    // retained; DeleteFile also refuses a still-mapped worker image below.
                    catch { continue; }
                    if (executable is null) continue;
                    var parent = Path.GetDirectoryName(Path.GetFullPath(executable));
                    if (parent is not null && DirectChild(root, parent)) retained.Add(Path.GetFileName(parent));
                }
            }
            var candidates = Directory.EnumerateDirectories(root)
                .Where(path => DirectChild(root, path) && GuidName(Path.GetFileName(path)))
                .Select(path => new DirectoryInfo(path)).OrderByDescending(info => info.LastWriteTimeUtc).ToArray();
            // Keep the newest useful updater rollback and one terminal diagnostic directory.
            var terminal = candidates.Where(info => TerminalOrAbandoned(info, now)).ToArray();
            var rollback = terminal.FirstOrDefault(info => File.Exists(Path.Combine(info.FullName, "previous.exe")));
            if (rollback is not null) retained.Add(rollback.Name);
            var newestTerminal = terminal.FirstOrDefault();
            if (newestTerminal is not null) retained.Add(newestTerminal.Name);
            foreach (var candidate in terminal)
            {
                if (retained.Contains(candidate.Name)) continue;
                try
                {
                    if (SafeAncestors(candidate.FullName) && SafeTree(candidate.FullName)) DeleteTerminalDirectory(candidate.FullName);
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException) { } // Locked workers retry on a later safe pass.
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException) { }
    }

    private static bool TerminalOrAbandoned(DirectoryInfo directory, DateTimeOffset now)
    {
        try
        {
            if ((directory.Attributes & FileAttributes.ReparsePoint) != 0) return false;
            var journal = Path.Combine(directory.FullName, "operation.json");
            if (!File.Exists(journal)) return directory.LastWriteTimeUtc < now.UtcDateTime.AddDays(-1);
            if ((File.GetAttributes(journal) & FileAttributes.ReparsePoint) != 0 || new FileInfo(journal).Length > 256 * 1024) return false;
            using var json = JsonDocument.Parse(File.ReadAllText(journal));
            return json.RootElement.ValueKind == JsonValueKind.Object && json.RootElement.TryGetProperty("status", out var status)
                && status.ValueKind == JsonValueKind.String && status.GetString() is "succeeded" or "failed" or "deferred";
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException) { return false; }
    }

    private static bool DirectChild(string root, string path) => string.Equals(Path.GetDirectoryName(Path.GetFullPath(path)),
        Path.TrimEndingDirectorySeparator(Path.GetFullPath(root)), StringComparison.OrdinalIgnoreCase);

    private static bool SafeAncestors(string path)
    {
        for (var node = new DirectoryInfo(Path.GetFullPath(path)); node is not null; node = node.Parent)
            if ((node.Attributes & FileAttributes.ReparsePoint) != 0) return false;
        return true;
    }

    private static bool SafeTree(string root)
    {
        var pending = new Stack<string>(); pending.Push(root);
        var count = 0;
        while (pending.TryPop(out var directory))
            foreach (var path in Directory.EnumerateFileSystemEntries(directory))
            {
                if (++count > 10000) return false;
                var attributes = File.GetAttributes(path);
                if ((attributes & FileAttributes.ReparsePoint) != 0) return false;
                if ((attributes & FileAttributes.Directory) != 0) pending.Push(path);
            }
        return true;
    }

    private static void DeleteTerminalDirectory(string root)
    {
        // Keep the terminal journal until every payload/subdirectory is gone.
        // A sharing violation must leave enough state for the next pass to retry.
        var journal = Path.Combine(root, "operation.json");
        foreach (var file in Directory.EnumerateFiles(root))
            if (!string.Equals(file, journal, StringComparison.OrdinalIgnoreCase)) File.Delete(file);
        foreach (var directory in Directory.EnumerateDirectories(root)) Directory.Delete(directory, recursive: true);
        File.Delete(journal);
        Directory.Delete(root);
    }
}
