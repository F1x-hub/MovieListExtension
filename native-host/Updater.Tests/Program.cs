using System.Reflection;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;

var updater = Assembly.Load("MovieListUpdater").GetType("Program", throwOnError: true)!;
var move = updater.GetMethod("MoveWithRetry", BindingFlags.Static | BindingFlags.NonPublic)!;
var root = Directory.CreateTempSubdirectory("movielist-replacement-test-").FullName;
try
{
    var installed = Path.Combine(root, "MovieListExtension-1.3.0");
    var recovery = Path.Combine(root, ".movielist-updater", "recovery", Guid.NewGuid().ToString());
    var staged = Path.Combine(root, ".movielist-updater", "staging", "extension");
    Directory.CreateDirectory(installed);
    Directory.CreateDirectory(staged);
    File.WriteAllText(Path.Combine(installed, "manifest.json"), "old-version");
    File.WriteAllText(Path.Combine(staged, "manifest.json"), "new-version");
    move.Invoke(null, new object[] { installed, recovery });
    move.Invoke(null, new object[] { staged, installed });
    if (File.ReadAllText(Path.Combine(installed, "manifest.json")) != "new-version"
        || File.ReadAllText(Path.Combine(recovery, "manifest.json")) != "old-version")
        throw new Exception("Fresh-install replacement lost source or replacement contents.");
    Directory.Delete(installed, recursive: true);
    move.Invoke(null, new object[] { recovery, installed });
    if (File.ReadAllText(Path.Combine(installed, "manifest.json")) != "old-version")
        throw new Exception("Recovery did not restore the original installation.");
    Console.WriteLine("Fresh-install replacement and recovery passed.");
    var download = updater.GetMethod("DownloadFile", BindingFlags.Static | BindingFlags.NonPublic)!;
    var portProbe = new TcpListener(IPAddress.Loopback, 0);
    portProbe.Start();
    var port = ((IPEndPoint)portProbe.LocalEndpoint).Port;
    portProbe.Stop();
    using var listener = new HttpListener();
    var origin = $"http://127.0.0.1:{port}/";
    listener.Prefixes.Add(origin);
    listener.Start();
    var requests = new System.Collections.Concurrent.ConcurrentDictionary<string, int>();
    var expected = new byte[] { 1, 2, 3, 4 };
    var hash = Convert.ToHexString(SHA256.HashData(expected));
    using var stopServer = new CancellationTokenSource();
    var server = Task.Run(async () => {
        while (listener.IsListening) {
            HttpListenerContext context;
            try { context = await listener.GetContextAsync(); }
            catch (Exception) when (stopServer.IsCancellationRequested) { break; }
            var route = context.Request.Url!.AbsolutePath;
            var count = requests.AddOrUpdate(route, 1, (_, value) => value + 1);
            if (route == "/missing") context.Response.StatusCode = 404;
            else if (route == "/retry" && count < 3) context.Response.StatusCode = 503;
            else {
                var bytes = route == "/corrupt" ? new byte[] { 4, 3, 2, 1 } : expected;
                context.Response.ContentLength64 = bytes.Length;
                await context.Response.OutputStream.WriteAsync(bytes);
            }
            context.Response.Close();
        }
    });
    try {
        foreach (var route in new[] { "missing", "corrupt", "retry" }) {
            requests.Clear();
            var destination = Path.Combine(root, "download.zip");
            download.Invoke(null, new object[] { new[] { origin + route, origin + "good" }, destination, hash, (long)expected.Length });
            if (!File.ReadAllBytes(destination).SequenceEqual(expected)) throw new Exception("Downloaded wrong bytes");
            if (requests["/" + route] != (route == "retry" ? 3 : 1)) throw new Exception("Incorrect retry classification");
            if (route != "retry" && requests["/good"] != 1) throw new Exception("Fallback was not used");
        }
        Console.WriteLine("HTTP 404 and SHA mismatch fallback; HTTP 503 third-attempt recovery passed.");
    } finally {
        stopServer.Cancel();
        listener.Stop();
        server.GetAwaiter().GetResult();
    }
}
finally
{
    Directory.Delete(root, recursive: true);
}
