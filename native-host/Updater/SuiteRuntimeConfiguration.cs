using System.Globalization;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.RegularExpressions;

// Reads only the installed, administrator-protected local configuration.
public static class SuiteRuntimeConfiguration
{
    public static int ReadPort(string suiteRoot)
    {
        var path = Path.Combine(Path.GetFullPath(suiteRoot), "config", "mediaplayer.env");
        AssertProtected(path);
        if (new FileInfo(path).Length > 256 * 1024) throw new InvalidDataException("Suite configuration too large.");
        return ParsePort(File.ReadAllLines(path));
    }

    public static int ParsePort(IEnumerable<string> lines)
    {
        int? port = null;
        foreach (var line in lines)
        {
            var match = Regex.Match(line, @"^\s*(?:export\s+)?PORT\s*=\s*(.*?)\s*$", RegexOptions.CultureInvariant);
            if (!match.Success) continue;
            if (port is not null) throw new InvalidDataException("Duplicate Suite port.");
            var value = match.Groups[1].Value;
            var comment = value.IndexOf('#');
            if (comment >= 0) value = value[..comment].TrimEnd();
            if (value.Length >= 2 && (value[0] == '\'' && value[^1] == '\'' || value[0] == '"' && value[^1] == '"')) value = value[1..^1];
            if (!Regex.IsMatch(value, @"^[0-9]{1,5}$", RegexOptions.CultureInvariant)
                || !int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) || parsed is < 1 or > 65535)
                throw new InvalidDataException("Invalid Suite port.");
            port = parsed;
        }
        return port ?? 3000;
    }

    public static Uri ReadyUri(int port) => port is >= 1 and <= 65535
        ? new Uri($"http://127.0.0.1:{port}/ready") : throw new InvalidDataException("Invalid Suite port.");

    private static void AssertProtected(string path)
    {
        FileSystemInfo node = new FileInfo(path);
        if (!node.Exists) throw new InvalidDataException("Suite configuration missing.");
        var leaf = true;
        for (; node is not null; node = node is DirectoryInfo d ? d.Parent! : ((FileInfo)node).Directory!, leaf = false)
        {
            if ((node.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Reparse configuration rejected.");
            FileSystemSecurity acl = node is DirectoryInfo directory ? directory.GetAccessControl() : ((FileInfo)node).GetAccessControl();
            if (!ProtectedAclIsSafe(acl, leaf)) throw new InvalidDataException("Writable or untrusted Suite configuration rejected.");
        }
    }

    public static bool ProtectedAclIsSafe(FileSystemSecurity acl, bool leaf)
    {
        bool Trusted(SecurityIdentifier sid) => sid.IsWellKnown(WellKnownSidType.LocalSystemSid)
            || sid.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid)
            || sid.Equals(new NTAccount(@"NT SERVICE\TrustedInstaller").Translate(typeof(SecurityIdentifier)));
        if (acl.GetOwner(typeof(SecurityIdentifier)) is not SecurityIdentifier owner || !Trusted(owner)) return false;
        var writes = FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles
            | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership
            | (FileSystemRights)0x50000000; // Raw GENERIC_WRITE and GENERIC_ALL can be present before access-mask mapping.
        if (leaf) writes |= FileSystemRights.WriteData | FileSystemRights.AppendData;
        foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(SecurityIdentifier)))
            if (rule.AccessControlType == AccessControlType.Allow && (rule.PropagationFlags & PropagationFlags.InheritOnly) == 0
                && (rule.FileSystemRights & writes) != 0 && rule.IdentityReference is SecurityIdentifier sid && !Trusted(sid)) return false;
        return true;
    }
}
