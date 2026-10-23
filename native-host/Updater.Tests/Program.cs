using System.Reflection;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

var updater = Assembly.Load("MovieListUpdater").GetType("Program", throwOnError: true)!;
var move = updater.GetMethod("MoveWithRetry", BindingFlags.Static | BindingFlags.NonPublic)!;
var root = Directory.CreateTempSubdirectory("movielist-replacement-test-").FullName;
try
{
    ComponentRegressionFixtures.Run(root);
    var poll = updater.GetMethod("PollSuiteBroker", BindingFlags.Static | BindingFlags.NonPublic)!;
    var pollingId = Guid.NewGuid().ToString("D");
    var tick = DateTimeOffset.UtcNow;
    var pollingStart = tick;
    var calls = 0;
    JsonElement Status(string phase, string operationId = null) => JsonSerializer.SerializeToElement(new {
        success = true, operation = new { operationId = operationId ?? pollingId, status = phase, wasRunning = true } });
    JsonElement OutageRequest()
    {
        calls++;
        if (calls == 1)
        {
            using var pipe = new System.IO.Pipes.NamedPipeClientStream(".", "movielist-missing-fixture-" + pollingId,
                System.IO.Pipes.PipeDirection.InOut, System.IO.Pipes.PipeOptions.Asynchronous);
            pipe.Connect(10); // A real missing service pipe raises TimeoutException.
        }
        if (calls == 2) throw new IOException("service pipe disconnected");
        if (calls == 3)
        {
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            Stream.Null.ReadExactlyAsync(new byte[1], cancelled.Token).AsTask().GetAwaiter().GetResult();
        }
        return Status(calls == 4 ? "installing" : "succeeded");
    }
    var observations = 0;
    var observedResult = (JsonElement)poll.Invoke(null, new object[] { pollingId, (Func<JsonElement>)OutageRequest,
        tick.AddSeconds(20), (Func<DateTimeOffset>)(() => tick), (Action<TimeSpan>)(delay => tick += delay),
        (Action<JsonElement>)(_ => observations++) })!;
    if (calls != 5 || observations != 2 || observedResult.GetProperty("status").GetString() != "succeeded")
        throw new Exception("Transient broker pipe outage interrupted an accepted update.");
    foreach (var terminal in new[] { "failed", "deferred", "recovery_required" })
    {
        var result = (JsonElement)poll.Invoke(null, new object[] { pollingId, (Func<JsonElement>)(() => Status(terminal)),
            tick.AddSeconds(20), (Func<DateTimeOffset>)(() => tick), (Action<TimeSpan>)(delay => tick += delay), null! })!;
        if (result.GetProperty("status").GetString() != terminal) throw new Exception("Broker terminal result was lost.");
    }
    foreach (var rejection in new[] { false, true })
    {
        tick = pollingStart; calls = 0;
        try
        {
            poll.Invoke(null, new object[] { pollingId, (Func<JsonElement>)(() => { calls++; return rejection
                ? JsonSerializer.SerializeToElement(new { success = false, errorCode = "OWNER_IDENTITY_REQUIRED" })
                : Status("succeeded", Guid.NewGuid().ToString("D")); }),
                tick.AddSeconds(6), (Func<DateTimeOffset>)(() => tick), (Action<TimeSpan>)(delay => tick += delay), null! });
            throw new Exception("Rejected/mismatched broker operation was accepted.");
        }
        catch (TargetInvocationException error) when (error.InnerException is IOException failure)
        {
            if (failure.Message != (rejection ? "SUITE_BROKER_REJECTED" : "SUITE_BROKER_TIMEOUT") || rejection && calls != 1)
                throw new Exception("Broker rejection/deadline was incorrectly retried or classified.");
        }
    }
    var resolution = updater.GetMethod("ConfirmedRepairTransaction", BindingFlags.Static | BindingFlags.NonPublic)!;
    try
    {
        poll.Invoke(null, new object[] { pollingId, (Func<JsonElement>)(() => Status("installing")), tick.AddSeconds(20),
            (Func<DateTimeOffset>)(() => tick), (Action<TimeSpan>)(delay => tick += delay),
            (Action<JsonElement>)(_ => throw new IOException("journal write failed")) });
        throw new Exception("Journal failure was swallowed as a pipe outage.");
    }
    catch (TargetInvocationException error) when (error.InnerException is IOException { Message: "journal write failed" }) { }
    var repairId = Guid.NewGuid().ToString("D");
    foreach (var status in new[] { "failed", "recovery_required", "installing" })
    foreach (var identity in new[] { pollingId, Guid.NewGuid().ToString("D") })
    foreach (var code in new[] { "SUITE_MANUAL_REPAIR_CONFIRMED", "INSTALL_FAILED" })
    {
        var response = JsonSerializer.SerializeToElement(new { success = true, operation = new {
            operationId = identity, status, errorCode = code, repairTransactionId = repairId } });
        var accepted = resolution.Invoke(null, new object[] { response, pollingId });
        if ((accepted is not null) != (status == "failed" && identity == pollingId && code == "SUITE_MANUAL_REPAIR_CONFIRMED"))
            throw new Exception("Native repair resolution accepted an unconfirmed or unrelated operation.");
    }
    Console.WriteLine("Production broker polling survives real connect timeout, disconnect and cancellation; terminal/rejection/deadline and confirmed repair identity checks passed.");
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
    using (var signingKey = RSA.Create(2048))
    {
        var key = signingKey.ExportSubjectPublicKeyInfoPem();
        var descriptor = new Dictionary<string, object> {
            ["version"] = "1.1.5", ["assetName"] = "MovieListSetup.exe",
            ["assetUrl"] = "https://github.com/F1x-hub/MovieListExtension/releases/download/v1.4.0/MovieListSetup.exe",
            ["sha256"] = new string('a', 64), ["size"] = 42L };
        string Catalog(Dictionary<string, object> entry, string id = "updater") => JsonSerializer.Serialize(new {
            schemaVersion = 1, productId = "movielist", channel = "stable", publishedAt = "2026-10-23T12:00:00Z",
            components = new Dictionary<string, object> { [id] = entry } });
        string Sign(string text) => Convert.ToBase64String(signingKey.SignData(Encoding.UTF8.GetBytes(text), HashAlgorithmName.SHA256, RSASignaturePadding.Pss));
        var text = Catalog(descriptor);
        var parsed = ComponentCatalogValidator.Validate(text, Sign(text), key);
        if (parsed.Components["updater"].Version != "1.1.5") throw new Exception("Valid catalog failed.");
        void Reject(string invalid, string signature)
        {
            try { ComponentCatalogValidator.Validate(invalid, signature, key); }
            catch { return; }
            throw new Exception("Unsafe component catalog was accepted.");
        }
        Reject(text.Replace("1.1.5", "1.1.6"), Sign(text));
        using (var otherKey = RSA.Create(2048))
            Reject(text, Convert.ToBase64String(otherKey.SignData(Encoding.UTF8.GetBytes(text), HashAlgorithmName.SHA256, RSASignaturePadding.Pss)));
        foreach (var change in new (string Property, object Value)[] {
            ("assetUrl", "https://evil.example/MovieListSetup.exe"),
            ("assetUrl", "https://github.com/F1x-hub/MovieListExtension/releases/download/v1.4.0/MovieListSetup.exe?download=1"),
            ("assetUrl", "https://github.com/F1x-hub/MovieListExtension/releases/download/../../MovieListSetup.exe"),
            ("assetName", "arbitrary.exe"), ("version", "1.1.5-beta"), ("version", "01.1.5"),
            ("size", 0L), ("size", ComponentCatalogValidator.MaxAssetBytes + 1), ("sha256", "x"),
            ("minUpdaterVersion", "latest") })
        {
            var invalidEntry = new Dictionary<string, object>(descriptor) { [change.Property] = change.Value };
            var invalid = Catalog(invalidEntry);
            Reject(invalid, Sign(invalid));
        }
        var unknown = Catalog(descriptor, "shell"); Reject(unknown, Sign(unknown));
        var duplicate = text.Replace("\"productId\":\"movielist\"", "\"productId\":\"movielist\",\"productId\":\"movielist\"");
        Reject(duplicate, Sign(duplicate));
        if (ComponentCatalogValidator.CompareVersions("1.1.4", "1.1.4.0") != 0
            || ComponentCatalogValidator.CompareVersions("1.1.4.1", "1.1.4") <= 0) throw new Exception("Version order invalid.");
        Console.WriteLine("Signed catalog: tampering, wrong key, origin/path/identity/size/version and duplicate-property rejection passed.");
    }
    var replaceUpdater = updater.GetMethod("ReplaceUpdaterFile", BindingFlags.Static | BindingFlags.NonPublic)!;
    var candidateFile = Path.Combine(root, "candidate.exe");
    var permanentFile = Path.Combine(root, "permanent.exe");
    var previousFile = Path.Combine(root, "previous.exe");
    File.WriteAllText(candidateFile, "verified-new"); File.WriteAllText(permanentFile, "working-old");
    File.WriteAllText(Path.Combine(root, "install.json"), "preserve-registration");
    replaceUpdater.Invoke(null, new object[] { candidateFile, permanentFile, previousFile,
        (Func<string, bool>)(file => File.ReadAllText(file) == "verified-new") });
    if (File.ReadAllText(previousFile) != "working-old") throw new Exception("Previous updater was not kept.");
    File.WriteAllText(permanentFile, "working-old");
    try { replaceUpdater.Invoke(null, new object[] { candidateFile, permanentFile, previousFile, (Func<string, bool>)(_ => false) }); }
    catch (TargetInvocationException) { }
    if (File.ReadAllText(permanentFile) != "working-old"
        || File.ReadAllText(Path.Combine(root, "install.json")) != "preserve-registration") throw new Exception("Updater rollback modified installation configuration.");
    var lockedFile = new FileStream(permanentFile, FileMode.Open, FileAccess.Read, FileShare.None);
    var unlock = Task.Run(async () => { await Task.Delay(250); lockedFile.Dispose(); });
    replaceUpdater.Invoke(null, new object[] { candidateFile, permanentFile, previousFile,
        (Func<string, bool>)(file => File.ReadAllText(file) == "verified-new") });
    unlock.GetAwaiter().GetResult();
    if (File.ReadAllText(permanentFile) != "verified-new") throw new Exception("Locked updater did not retry.");
    Console.WriteLine("Updater file activation, preserved registration, rollback, and real locked-file retry passed.");
    File.Copy(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "ping.exe"), permanentFile, overwrite: true);
    using (var runningImage = Process.Start(new ProcessStartInfo(permanentFile) {
        UseShellExecute = false, CreateNoWindow = true, ArgumentList = { "-n", "3", "127.0.0.1" },
        RedirectStandardOutput = true, RedirectStandardError = true })!)
    {
        try
        {
            Thread.Sleep(100);
            replaceUpdater.Invoke(null, new object[] { candidateFile, permanentFile, previousFile,
                (Func<string, bool>)(file => File.ReadAllText(file) == "verified-new") });
            if (File.ReadAllText(permanentFile) != "verified-new") throw new Exception("Running executable replacement did not complete.");
        }
        finally { if (!runningImage.WaitForExit(5000)) { runningImage.Kill(); runningImage.WaitForExit(); } }
    }
    Console.WriteLine("Real running Windows executable replacement retries sharing/access denial and completes atomically.");
    var setupDecision = updater.GetMethod("ShouldReplaceSetupUpdater", BindingFlags.Static | BindingFlags.NonPublic)!;
    bool ShouldCopy(string running, string installedVersion, bool runningCapability, bool installedCapability) =>
        (bool)setupDecision.Invoke(null, new object[] { Version.Parse(running), Version.Parse(installedVersion), runningCapability, installedCapability })!;
    if (!ShouldCopy("1.1.4.0", "1.1.4.0", true, false)
        || ShouldCopy("1.1.4.0", "1.1.4.0", true, true)
        || ShouldCopy("1.1.4.0", "1.1.4.0", false, true)
        || ShouldCopy("1.1.3.0", "1.1.4.0", true, false)) throw new Exception("Same-version capability migration/downgrade gate invalid.");
    Console.WriteLine("Legacy 1.1.4 same-version Setup migration requires missing installed capability; capable/equal and older candidates cannot replace it.");
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
