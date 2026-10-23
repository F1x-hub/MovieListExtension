using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;

// Fixed service identity only. HTTP failure is never interpreted as stopped.
public static class WindowsServiceInspector
{
    public sealed record Snapshot(string Status, uint ProcessId);
    public static Snapshot GetTorrentService()
    {
        var manager = OpenSCManager(null, null, 1);
        if (manager == IntPtr.Zero) return new("unknown", 0);
        try
        {
            var service = OpenService(manager, "MediaPlayerTorrentService", 4);
            if (service == IntPtr.Zero) return new("unknown", 0);
            try
            {
                if (!QueryServiceStatusEx(service, 0, out var status, (uint)Marshal.SizeOf<ServiceStatus>(), out _)) return new("unknown", 0);
                return new(status.CurrentState switch { 1 => "stopped", 4 => "running", _ => "transition" }, status.ProcessId);
            }
            finally { CloseServiceHandle(service); }
        }
        finally { CloseServiceHandle(manager); }
    }

    public static bool NoListenerOrOrphan(string suiteRoot, int port)
    {
        try
        {
            if (port is < 1 or > 65535 || IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(endpoint => endpoint.Port == port)) return false;
            var expectedNode = Path.GetFullPath(Path.Combine(suiteRoot, "current", "runtime", "node", "node.exe"));
            foreach (var process in Process.GetProcessesByName("node"))
            {
                using (process)
                {
                    string? executable;
                    try { executable = process.MainModule?.FileName; }
                    catch (Exception) { return false; }
                    if (executable is null || string.Equals(Path.GetFullPath(executable), expectedNode, StringComparison.OrdinalIgnoreCase)) return false;
                }
            }
            return true;
        }
        catch { return false; }
    }

    [StructLayout(LayoutKind.Sequential)] private struct ServiceStatus
    {
        public uint ServiceType, CurrentState, ControlsAccepted, Win32ExitCode, ServiceSpecificExitCode,
            CheckPoint, WaitHint, ProcessId, ServiceFlags;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr OpenSCManager(string? machine, string? database, uint access);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr OpenService(IntPtr manager, string name, uint access);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryServiceStatusEx(IntPtr service, int infoLevel, out ServiceStatus status, uint size, out uint needed);
    [DllImport("advapi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseServiceHandle(IntPtr handle);
}
