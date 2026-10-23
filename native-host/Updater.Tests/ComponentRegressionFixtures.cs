#nullable enable
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;

internal static class ComponentRegressionFixtures
{
    public static void Run(string fixtureRoot)
    {
        if (SuiteRuntimeConfiguration.ParsePort(["CUSTOM=value"]) != 3000
            || SuiteRuntimeConfiguration.ParsePort(["PORT='43127' # retained custom port"]) != 43127
            || SuiteRuntimeConfiguration.ParsePort(["export PORT=65535"]) != 65535)
            throw new Exception("Valid configured/default port was rejected.");
        foreach (var lines in new[] { new[] { "PORT=0" }, ["PORT=65536"], ["PORT=http://evil.example/"],
            ["PORT=3000", "PORT=4000"], ["PORT="], ["PORT=3000/path"], ["PORT=+3000"] })
        {
            try { SuiteRuntimeConfiguration.ParsePort(lines); }
            catch (InvalidDataException) { continue; }
            throw new Exception("Invalid/duplicate/remote port was accepted.");
        }
        var custom = new TcpListener(IPAddress.Loopback, 0); custom.Start();
        try
        {
            var port = ((IPEndPoint)custom.LocalEndpoint).Port;
            var ready = SuiteRuntimeConfiguration.ReadyUri(port);
            if (ready.Host != "127.0.0.1" || ready.Port != port || ready.AbsolutePath != "/ready"
                || WindowsServiceInspector.NoListenerOrOrphan(fixtureRoot, port))
                throw new Exception("Custom configured listener was not considered by stopped-service guard.");
        }
        finally { custom.Stop(); }
        var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
        var users = new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null);
        DirectorySecurity Acl(FileSystemRights rights, PropagationFlags propagation = PropagationFlags.None)
        {
            var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true, false); acl.SetOwner(system);
            if (((uint)rights & 0x50000000) != 0)
            {
                acl.SetSecurityDescriptorSddlForm($"O:SYG:SYD:P(A;;FA;;;SY)(A;;0x{(uint)rights:x8};;;BU)");
                return acl;
            }
            acl.AddAccessRule(new FileSystemAccessRule(system, FileSystemRights.FullControl, AccessControlType.Allow));
            acl.AddAccessRule(new FileSystemAccessRule(users, rights,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, propagation, AccessControlType.Allow));
            return acl;
        }
        if (!SuiteRuntimeConfiguration.ProtectedAclIsSafe(Acl(FileSystemRights.ReadAndExecute), true)
            || !SuiteRuntimeConfiguration.ProtectedAclIsSafe(Acl(FileSystemRights.WriteData, PropagationFlags.InheritOnly), true)
            || SuiteRuntimeConfiguration.ProtectedAclIsSafe(Acl(FileSystemRights.WriteData), true)
            || SuiteRuntimeConfiguration.ProtectedAclIsSafe(Acl((FileSystemRights)0x40000000), false)
            || SuiteRuntimeConfiguration.ProtectedAclIsSafe(Acl((FileSystemRights)0x10000000), false))
            throw new Exception("Protected config ACL accepted writable or raw generic write grants.");
        Console.WriteLine("Configured/default PORT validation, loopback URI, real custom listener and effective config ACL checks passed.");

        var root = Path.Combine(fixtureRoot, "work-cache"); Directory.CreateDirectory(root);
        var now = DateTimeOffset.UtcNow;
        string Work(string? status, int age, bool rollback = false)
        {
            var path = Path.Combine(root, Guid.NewGuid().ToString("D")); Directory.CreateDirectory(path);
            File.WriteAllText(Path.Combine(path, "payload.exe"), "test-only");
            if (status is not null) File.WriteAllText(Path.Combine(path, "operation.json"), JsonSerializer.Serialize(new { status }));
            if (rollback) File.WriteAllText(Path.Combine(path, "previous.exe"), "rollback");
            Directory.SetLastWriteTimeUtc(path, now.UtcDateTime.AddMinutes(-age)); return path;
        }
        var malformed = Work("failed", 900); File.WriteAllText(Path.Combine(malformed, "operation.json"), "{truncated");
        var unknown = Work("future_status", 900);
        var active = Work("installing", 10);
        var recovery = Work("recovery_required", 12);
        var retained = Work("failed", 100);
        var newest = Work("succeeded", 1);
        var rollback = Work("succeeded", 50, rollback: true);
        var previousRollback = Work("succeeded", 90, rollback: true);
        var abandoned = Work(null, 3 * 24 * 60);
        var old = Enumerable.Range(0, 530).Select(i => Work(i % 2 == 0 ? "failed" : "deferred", 120 + i)).ToArray();
        var locked = Work("failed", 500);
        var liveWorker = Work("failed", 510);
        var workerFile = Path.Combine(liveWorker, "worker.exe");
        File.Copy(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "ping.exe"), workerFile);
        Directory.SetLastWriteTimeUtc(liveWorker, now.UtcDateTime.AddMinutes(-510));
        var outside = Path.Combine(fixtureRoot, "outside-cache"); Directory.CreateDirectory(outside);
        File.WriteAllText(Path.Combine(outside, "keep.txt"), "outside");
        var alias = Work("failed", 520);
        var junction = Path.Combine(alias, "alias");
        using (var link = Process.Start(new ProcessStartInfo("cmd.exe") { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true, ArgumentList = { "/d", "/c", "mklink", "/J", junction, outside } })!)
        { link.WaitForExit(); if (link.ExitCode != 0) throw new Exception("Cache reparse fixture creation failed: " + link.StandardError.ReadToEnd()); }
        Directory.SetLastWriteTimeUtc(alias, now.UtcDateTime.AddMinutes(-520));
        var unowned = Path.Combine(root, "unowned"); Directory.CreateDirectory(unowned);
        using (var live = Process.Start(new ProcessStartInfo(workerFile) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true, ArgumentList = { "-t", "127.0.0.1" } })!)
        {
            try
            {
                Thread.Sleep(100);
                // Simulate an uninspectable process: even without its executable
                // in the retention set, a mapped image prevents payload cleanup,
                // and the journal must remain intact for a later retry.
                var delete = typeof(ComponentWorkCache).GetMethod("DeleteTerminalDirectory", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!;
                try { delete.Invoke(null, new object[] { liveWorker }); throw new Exception("A running worker image was deleted."); }
                catch (System.Reflection.TargetInvocationException error) when (error.InnerException is IOException or UnauthorizedAccessException) { }
                if (!File.Exists(Path.Combine(liveWorker, "operation.json")) || !File.Exists(workerFile))
                    throw new Exception("Failed mapped-worker cleanup discarded its journal/image.");
                Directory.SetLastWriteTimeUtc(liveWorker, now.UtcDateTime.AddMinutes(-510));
                using (var held = new FileStream(Path.Combine(locked, "payload.exe"), FileMode.Open, FileAccess.Read, FileShare.None))
                    ComponentWorkCache.Prune(root, [Path.GetFileName(retained)], now);
                foreach (var path in new[] { malformed, unknown, active, recovery, retained, newest, rollback, locked, liveWorker, alias, unowned })
                    if (!Directory.Exists(path)) throw new Exception("Cache removed retained/unknown/locked/active/reparse work: " + path);
                if (old.Any(Directory.Exists) || Directory.Exists(previousRollback) || Directory.Exists(abandoned)
                    || File.ReadAllText(Path.Combine(outside, "keep.txt")) != "outside")
                    throw new Exception("Cache failed to prune all terminal operations beyond 512 or crossed a reparse alias.");
            }
            finally { live.Kill(); live.WaitForExit(); }
        }
        ComponentWorkCache.Prune(root, [Path.GetFileName(retained)], now);
        if (Directory.Exists(locked) || Directory.Exists(liveWorker)) throw new Exception("Unlocked/exited worker cache was not reclaimed on the next pass.");
        // Delete only the fixture junction itself so generic test teardown cannot traverse it.
        Directory.Delete(junction);
        Console.WriteLine("Real cache fixture: 530 terminal dirs, malformed journal isolation, rollback retention, active/recovery/worker/locked/reparse safety and retry cleanup passed.");
    }
}
