using System.Diagnostics;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

internal static partial class Program
{
    private const string SuiteUninstallKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{E24DC812-7575-4827-9BD8-5571A5E2D2F3}_is1";
    private const string ComponentRecoveryRunOnceName = "MovieListComponentRecovery";
    private static string ComponentRoot => Path.Combine(DataRoot, "components");
    private static string ComponentStatePath => Path.Combine(ComponentRoot, "operation.json");
    private static string ComponentWork(string id) => Path.Combine(ComponentRoot, id);
    private static string PermanentUpdater => Path.Combine(DataRoot, "MovieListUpdater.exe");

    private sealed class ComponentInput
    {
        public string ComponentId { get; set; } = "";
        public string MetadataText { get; set; } = "";
        public string Signature { get; set; } = "";
    }

    private sealed class ComponentOperation
    {
        public string OperationId { get; set; } = "";
        public string ComponentId { get; set; } = "";
        public string Version { get; set; } = "";
        public string Status { get; set; } = "queued";
        public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
        public string? ErrorCode { get; set; }
        public bool? WasRunning { get; set; }
        public string? RepairTransactionId { get; set; }
        public string? RecoveryErrorCode { get; set; }
    }

    private sealed record SuiteInventory(bool Installed, bool LayoutValid, string? InstallPath,
        string? Version, int? ApiMajor, string? BuildId, string Status, bool BrokerAvailable,
        bool? Running = null, bool Ready = false, string ServiceStatus = "unknown");

    private static ComponentOperation? ReadComponentOperation() => ReadJson<ComponentOperation>(ComponentStatePath);
    private static bool IsComponentOperationPending(ComponentOperation? operation) => operation?.Status is
        "queued" or "downloading" or "replacing" or "installing" or "verifying" or "recovery_required";

    private static object ValidateComponentCatalogRequest(JsonElement request)
    {
        try
        {
            var catalog = ComponentCatalogValidator.Validate(request.GetProperty("metadataText").GetString()!,
                request.GetProperty("signature").GetString()!, ReleasePublicKey);
            return new { success = true, components = catalog.Components };
        }
        catch { return ErrorResponse("COMPONENT_CATALOG_INVALID", "Component catalog verification failed."); }
    }

    private static bool ShouldReplaceSetupUpdater(Version runningVersion, Version? installedVersion,
        bool runningCapable, bool installedCapable) => installedVersion is null
        || runningVersion.CompareTo(installedVersion) > 0
        || runningVersion.CompareTo(installedVersion) == 0 && runningCapable && !installedCapable;

    private static void RecoverStaleComponentOperation()
    {
        var state = ReadComponentOperation();
        if (!IsComponentOperationPending(state) || !Guid.TryParseExact(state!.OperationId, "D", out _)) return;
        using var mutex = new Mutex(false, UserApplyMutexName);
        if (!TryAcquireOperationMutex(mutex)) return;
        try
        {
            if (ReconcileSuiteRepair(state) || state.UpdatedAt > DateTimeOffset.UtcNow.Subtract(StaleOperationAge)
                || state.Status == "recovery_required" && state.ComponentId != "updater") return;
            var worker = Path.Combine(ComponentWork(state.OperationId), "worker.exe");
            RejectReparsePoints(ComponentWork(state.OperationId));
            if (!File.Exists(worker)) { FinishComponent(state, "recovery_required", "COMPONENT_WORKER_MISSING"); return; }
            var input = ReadJson<ComponentInput>(Path.Combine(ComponentWork(state.OperationId), "input.json"))
                ?? throw new InvalidDataException();
            ComponentCatalogValidator.Validate(input.MetadataText, input.Signature, ReleasePublicKey);
            state.UpdatedAt = DateTimeOffset.UtcNow; WriteJsonAtomic(ComponentStatePath, state);
            Process.Start(new ProcessStartInfo(worker) { UseShellExecute = false, CreateNoWindow = true,
                ArgumentList = { "--component-worker", state.OperationId } })?.Dispose();
        }
        catch { FinishComponent(state, "recovery_required", "COMPONENT_RECOVERY_REQUIRED"); }
        finally { mutex.ReleaseMutex(); }
    }

    private static object GetComponentInventory(InstallConfig config) => new
    {
        extension = new { installed = true, version = ReadCurrentManifestVersion(config.ExtensionPath)?.ToString() },
        updater = new { installed = File.Exists(PermanentUpdater), version = UpdaterVersion },
        mediaPlayerSuite = ReadSuiteInventory()
    };

    private static SuiteInventory ReadSuiteInventory()
    {
        using var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
        using var installed = machine.OpenSubKey(SuiteUninstallKey);
        if (installed is null) return new(false, false, null, null, null, null, "absent", false);
        var location = installed.GetValue("InstallLocation") as string;
        if (string.IsNullOrWhiteSpace(location) || !Path.IsPathFullyQualified(location))
            return new(true, false, null, null, null, null, "installation_invalid", false);
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(location));
        var current = Path.Combine(root, "current");
        var layout = File.Exists(Path.Combine(current, "app", "dist", "server.js"))
            && File.Exists(Path.Combine(current, "runtime", "node", "node.exe"))
            && File.Exists(Path.Combine(current, "bridge", "MediaPlayerBridge.exe"));
        string? version = null, build = null;
        int? api = null;
        try
        {
            var markerPath = Path.Combine(current, "suite-version.json");
            if (new FileInfo(markerPath).Length > 8192) throw new InvalidDataException();
            using var marker = JsonDocument.Parse(File.ReadAllText(markerPath));
            version = marker.RootElement.GetProperty("version").GetString();
            if (!ComponentCatalogValidator.IsStableVersion(version ?? "")) version = null;
            if (marker.RootElement.TryGetProperty("apiMajor", out var a)) api = a.GetInt32();
            if (marker.RootElement.TryGetProperty("buildId", out var b)) build = b.GetString();
        }
        catch (Exception error) when (error is IOException or JsonException or InvalidOperationException or KeyNotFoundException) { }
        var broker = false;
        if (layout)
        {
            try { broker = BrokerRequest(new { action = "status" }).GetProperty("success").GetBoolean(); }
            catch (Exception error) when (error is IOException or TimeoutException or JsonException or KeyNotFoundException or OperationCanceledException or InvalidOperationException) { }
        }
        var service = WindowsServiceInspector.GetTorrentService();
        bool? running = service.Status == "running" ? true : service.Status == "stopped" ? false : null;
        var ready = false;
        if (running == true)
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
                using var response = client.GetAsync(SuiteRuntimeConfiguration.ReadyUri(SuiteRuntimeConfiguration.ReadPort(root))).GetAwaiter().GetResult();
                ready = response.IsSuccessStatusCode;
            }
            catch (Exception error) when (error is HttpRequestException or OperationCanceledException or IOException or UnauthorizedAccessException) { }
        }
        return new(true, layout, root, version, api, build,
            !layout ? "installation_invalid" : version is null ? "migration_required" : "installed", broker, running, ready, service.Status);
    }

    private static object StartComponentApply(JsonElement request)
    {
        var id = request.TryGetProperty("componentId", out var component) ? component.GetString() : null;
        var operationId = request.TryGetProperty("operationId", out var op) ? op.GetString() : null;
        var text = request.TryGetProperty("metadataText", out var metadata) ? metadata.GetString() : null;
        var signature = request.TryGetProperty("signature", out var sig) ? sig.GetString() : null;
        if (id is not ("updater" or "mediaPlayerSuite") || !Guid.TryParse(operationId, out var parsed)
            || text is null || signature is null)
            return ErrorResponse("COMPONENT_REQUEST_INVALID", "Invalid component request.");
        operationId = parsed.ToString("D");
        using var mutex = new Mutex(false, UserApplyMutexName);
        if (!TryAcquireOperationMutex(mutex)) return ErrorResponse("UPDATE_IN_PROGRESS", "Another update is running.");
        try
        {
            var catalog = ComponentCatalogValidator.Validate(text, signature, ReleasePublicKey);
            if (!catalog.Components.TryGetValue(id, out var descriptor)) throw new InvalidDataException("Missing component.");
            var current = ReadComponentOperation();
            if (current is not null && ReconcileSuiteRepair(current)) current = ReadComponentOperation();
            if (IsComponentOperationPending(current))
                return current!.OperationId == operationId
                    ? new { success = true, operationId, status = current.Status }
                    : ErrorResponse("UPDATE_IN_PROGRESS", "Another component is running.");
            var extensionOperation = ReadJson<OperationState>(StatePath);
            if (extensionOperation?.Status is "queued" or "downloading" or "replacing" or "awaiting_confirmation"
                || extensionOperation?.CleanupPending == true)
                return ErrorResponse("UPDATE_IN_PROGRESS", "An extension update needs completion.");
            ValidateComponentActivation(id, descriptor);
            ProtectUserComponentDirectory(ComponentRoot);
            ComponentWorkCache.Prune(ComponentRoot, current is null ? [] : [current.OperationId], DateTimeOffset.UtcNow);
            var work = ComponentWork(operationId);
            if (Directory.Exists(work)) return ErrorResponse("OPERATION_ID_REUSED", "Use a new operation identity.");
            ProtectUserComponentDirectory(work);
            WriteJsonAtomic(Path.Combine(work, "input.json"), new ComponentInput { ComponentId = id, MetadataText = text, Signature = signature });
            var worker = Path.Combine(work, "worker.exe");
            File.Copy(Environment.ProcessPath ?? throw new IOException("Missing host executable."), worker);
            var state = new ComponentOperation { OperationId = operationId, ComponentId = id, Version = descriptor.Version };
            WriteJsonAtomic(ComponentStatePath, state);
            using var runOnce = Registry.CurrentUser.CreateSubKey(RecoveryRunOncePath);
            runOnce.SetValue(ComponentRecoveryRunOnceName, $"\"{worker}\" --component-worker {operationId}");
            Process.Start(new ProcessStartInfo(worker) {
                UseShellExecute = false, CreateNoWindow = true,
                ArgumentList = { "--component-worker", operationId } })?.Dispose();
            return new { success = true, operationId, status = "queued" };
        }
        catch (Exception error)
        {
            return ErrorResponse(error is ComponentFailure failure ? failure.Code : "COMPONENT_REQUEST_REJECTED",
                "The component update could not be started.");
        }
        finally { mutex.ReleaseMutex(); }
    }

    private sealed class ComponentFailure(string code) : IOException(code) { public string Code { get; } = code; }

    private static void ValidateComponentActivation(string id, ComponentDescriptor descriptor)
    {
        if (descriptor.MinUpdaterVersion is not null
            && ComponentCatalogValidator.CompareVersions(UpdaterVersion, descriptor.MinUpdaterVersion) < 0)
            throw new ComponentFailure("UPDATER_UPGRADE_REQUIRED");
        if (id == "updater")
        {
            var installedVersion = ReadUpdaterVersion(PermanentUpdater)?.ToString() ?? UpdaterVersion;
            if (ComponentCatalogValidator.CompareVersions(descriptor.Version, installedVersion) <= 0)
                throw new ComponentFailure("COMPONENT_NOT_NEWER");
            return;
        }
        var suite = ReadSuiteInventory();
        if (!suite.Installed) throw new ComponentFailure("SUITE_NOT_INSTALLED");
        if (!suite.LayoutValid) throw new ComponentFailure("SUITE_INSTALLATION_INVALID");
        if (suite.Version is null) throw new ComponentFailure("SUITE_MIGRATION_REQUIRED");
        if (descriptor.ApiMajor is not null && descriptor.ApiMajor != 1) throw new ComponentFailure("SUITE_API_UNSUPPORTED");
        if (ComponentCatalogValidator.CompareVersions(descriptor.Version, suite.Version) <= 0)
            throw new ComponentFailure("COMPONENT_NOT_NEWER");
    }

    private static bool TryRunComponentMode(string[] args, out int exitCode)
    {
        exitCode = 0;
        if (args.Length == 1 && args[0] == "--component-probe")
        {
            using var output = Console.OpenStandardOutput();
            output.Write(JsonSerializer.SerializeToUtf8Bytes(new { productId = "movielist", componentId = "updater",
                version = UpdaterVersion, protocolVersion = 1, componentProtocolVersion = 1 }, JsonOptions));
            output.Flush();
            return true;
        }
        if (args.Length == 2 && args[0] == "--component-worker")
        {
            exitCode = Guid.TryParse(args[1], out var id) ? ExecuteComponentOperation(id.ToString("D")) : 1;
            return true;
        }
        return false;
    }

    private static int ExecuteComponentOperation(string id)
    {
        using var mutex = new Mutex(false, UserApplyMutexName);
        var acquired = false;
        try
        {
            try { acquired = mutex.WaitOne(TimeSpan.FromSeconds(30)); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) return 1;
            var state = ReadComponentOperation() ?? throw new InvalidDataException("Missing component journal.");
            if (state.OperationId != id || !IsComponentOperationPending(state)) return 0;
            var work = ComponentWork(id);
            RejectReparsePoints(work);
            var expectedWorker = Path.Combine(work, "worker.exe");
            if (!string.Equals(Path.GetFullPath(Environment.ProcessPath!), expectedWorker, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Invalid worker identity.");
            var input = ReadJson<ComponentInput>(Path.Combine(work, "input.json")) ?? throw new InvalidDataException("Missing input.");
            var catalog = ComponentCatalogValidator.Validate(input.MetadataText, input.Signature, ReleasePublicKey);
            if (state.ComponentId != input.ComponentId || !catalog.Components.TryGetValue(input.ComponentId, out var descriptor)
                || state.Version != descriptor.Version) throw new InvalidDataException("Journal mismatch.");
            var candidate = Path.Combine(work, descriptor.AssetName);
            // A previous crash after the rename is recovered through the signed probe.
            if (input.ComponentId == "updater" && ProbeUpdater(PermanentUpdater, descriptor.Version))
            {
                FinishComponent(state, "succeeded");
                return 0;
            }
            if (input.ComponentId == "mediaPlayerSuite" && VerifySuiteActivation(descriptor, state.WasRunning == false))
            {
                FinishComponent(state, "succeeded"); return 0;
            }
            ValidateComponentActivation(input.ComponentId, descriptor);
            if (input.ComponentId == "mediaPlayerSuite")
            {
                var suite = ReadSuiteInventory();
                if (suite.BrokerAvailable)
                {
                    SetComponentPhase(state, "installing");
                    var broker = BrokerRequest(new { action = "apply", operationId = id, metadataText = input.MetadataText, signature = input.Signature });
                    if (!broker.TryGetProperty("success", out var ok) || !ok.GetBoolean()) throw new ComponentFailure("SUITE_BROKER_REJECTED");
                    var operation = PollSuiteBroker(id, () => BrokerRequest(new { action = "status" }), DateTimeOffset.UtcNow.AddMinutes(45),
                        () => DateTimeOffset.UtcNow, Thread.Sleep, observed => {
                            if (observed.TryGetProperty("wasRunning", out var running) && running.ValueKind is JsonValueKind.True or JsonValueKind.False)
                            { state.WasRunning = running.GetBoolean(); WriteJsonAtomic(ComponentStatePath, state); }
                        });
                    var phase = operation.GetProperty("status").GetString();
                    if (operation.TryGetProperty("wasRunning", out var wasRunning) && wasRunning.ValueKind is JsonValueKind.True or JsonValueKind.False)
                    { state.WasRunning = wasRunning.GetBoolean(); WriteJsonAtomic(ComponentStatePath, state); }
                    if (phase == "succeeded")
                    {
                        if (!VerifySuiteActivation(descriptor, state.WasRunning == false)) throw new ComponentFailure("SUITE_ACTIVATION_NOT_CONFIRMED");
                        FinishComponent(state, "succeeded"); return 0;
                    }
                    throw new ComponentFailure("SUITE_BROKER_" + phase!.ToUpperInvariant());
                }
                if (state.Status is "installing" or "verifying" or "recovery_required")
                    throw new ComponentFailure("SUITE_RECOVERY_REQUIRED");
            }
            SetComponentPhase(state, "downloading");
            // Component downloads are allowed up to 1 GiB and never use a mirror.
            DownloadComponentFile(descriptor, candidate);
            ValidateComponentActivation(input.ComponentId, descriptor);
            if (input.ComponentId == "updater")
            {
                if (!ProbeUpdater(candidate, descriptor.Version)) throw new ComponentFailure("UPDATER_PROBE_FAILED");
                SetComponentPhase(state, "replacing");
                ReplaceUpdaterFile(candidate, PermanentUpdater, Path.Combine(work, "previous.exe"),
                    path => ProbeUpdater(path, descriptor.Version));
            }
            else
            {
                var suite = ReadSuiteInventory();
                state.WasRunning = suite.Running;
                SetComponentPhase(state, "installing");
                var start = new ProcessStartInfo(candidate) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
                foreach (var argument in new[] { "/UPGRADEONLY=1", "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", "/DIR=" + suite.InstallPath }) start.ArgumentList.Add(argument);
                using var process = Process.Start(start) ?? throw new IOException("Installer failed to start.");
                if (!process.WaitForExit(10 * 60 * 1000) || process.ExitCode != 0) throw new ComponentFailure("SUITE_INSTALL_FAILED");
                SetComponentPhase(state, "verifying");
                if (!VerifySuiteActivation(descriptor, state.WasRunning == false)) throw new ComponentFailure("SUITE_VERSION_MISMATCH");
            }
            FinishComponent(state, "succeeded");
            return 0;
        }
        catch (Exception error)
        {
            var state = ReadComponentOperation();
            if (state?.OperationId == id) FinishComponent(state,
                error is ComponentFailure failure && (failure.Code.EndsWith("RECOVERY_REQUIRED", StringComparison.Ordinal)
                    || failure.Code == "SUITE_BROKER_TIMEOUT") ? "recovery_required" : "failed",
                error is ComponentFailure f ? f.Code : "COMPONENT_EXECUTION_FAILED");
            return 1;
        }
        finally { if (acquired) mutex.ReleaseMutex(); }
    }

    private static void SetComponentPhase(ComponentOperation state, string status)
    {
        state.Status = status; state.UpdatedAt = DateTimeOffset.UtcNow;
        WriteJsonAtomic(ComponentStatePath, state);
        var work = ComponentWork(state.OperationId);
        if (Directory.Exists(work)) WriteJsonAtomic(Path.Combine(work, "operation.json"), state);
    }

    private static void FinishComponent(ComponentOperation state, string status, string? errorCode = null)
    {
        state.ErrorCode = errorCode;
        SetComponentPhase(state, status);
        if (status == "recovery_required") return;
        using var key = Registry.CurrentUser.OpenSubKey(RecoveryRunOncePath, writable: true);
        var command = key?.GetValue(ComponentRecoveryRunOnceName) as string;
        if (command?.EndsWith(state.OperationId, StringComparison.Ordinal) == true)
            key!.DeleteValue(ComponentRecoveryRunOnceName, throwOnMissingValue: false);
        ComponentWorkCache.Prune(ComponentRoot, [state.OperationId], DateTimeOffset.UtcNow);
    }

    private static bool ReconcileSuiteRepair(ComponentOperation state)
    {
        if (state.ComponentId != "mediaPlayerSuite" || state.Status != "recovery_required") return false;
        try
        {
            var response = BrokerRequest(new { action = "status" });
            var transaction = ConfirmedRepairTransaction(response, state.OperationId);
            if (transaction is null) return false;
            state.RepairTransactionId = transaction;
            state.RecoveryErrorCode ??= state.ErrorCode;
            FinishComponent(state, "failed", "SUITE_MANUAL_REPAIR_CONFIRMED");
            return true;
        }
        catch (Exception error) when (error is IOException or TimeoutException or OperationCanceledException or JsonException or KeyNotFoundException or InvalidOperationException) { return false; }
    }

    private static string? ConfirmedRepairTransaction(JsonElement response, string operationId)
    {
        if (!response.TryGetProperty("success", out var success) || success.ValueKind != JsonValueKind.True
            || !response.TryGetProperty("operation", out var operation) || operation.ValueKind != JsonValueKind.Object
            || operation.GetProperty("operationId").GetString() != operationId
            || operation.GetProperty("status").GetString() != "failed"
            || operation.GetProperty("errorCode").GetString() != "SUITE_MANUAL_REPAIR_CONFIRMED"
            || !Guid.TryParseExact(operation.GetProperty("repairTransactionId").GetString(), "D", out var transaction)) return null;
        return transaction.ToString("D");
    }

    // Clock and transport are injected so service outages are exercised without waiting 45 minutes.
    private static JsonElement PollSuiteBroker(string id, Func<JsonElement> request, DateTimeOffset deadline,
        Func<DateTimeOffset> clock, Action<TimeSpan> delay, Action<JsonElement>? observed)
    {
        while (clock() < deadline)
        {
            delay(TimeSpan.FromSeconds(2));
            if (clock() >= deadline) break;
            JsonElement status;
            try { status = request(); }
            catch (Exception error) when (error is not ComponentFailure && (error is IOException or TimeoutException or OperationCanceledException)) { continue; }
            if (status.TryGetProperty("success", out var success) && success.ValueKind == JsonValueKind.False)
                throw new ComponentFailure("SUITE_BROKER_REJECTED");
            if (status.TryGetProperty("operation", out var operation) && operation.ValueKind == JsonValueKind.Object
                && operation.GetProperty("operationId").GetString() == id)
            {
                observed?.Invoke(operation);
                if (operation.GetProperty("status").GetString() is "succeeded" or "failed" or "deferred" or "recovery_required") return operation.Clone();
            }
        }
        throw new ComponentFailure("SUITE_BROKER_TIMEOUT");
    }

    private static void DownloadComponentFile(ComponentDescriptor descriptor, string destination)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(descriptor.AssetName == "MediaPlayerSuiteSetup.exe" ? 30 : 10));
        using var client = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        Exception? last = null;
        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                using var header = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token);
                header.CancelAfter(TimeSpan.FromSeconds(15));
                using var response = client.GetAsync(descriptor.AssetUrl, HttpCompletionOption.ResponseHeadersRead, header.Token).GetAwaiter().GetResult();
                response.EnsureSuccessStatusCode();
                if (response.Content.Headers.ContentLength is long length && length != descriptor.Size) throw new InvalidDataException("Size mismatch.");
                using var source = response.Content.ReadAsStream();
                using (var target = File.Create(destination))
                {
                    var buffer = new byte[64 * 1024]; long total = 0;
                    while (true)
                    {
                        using var idle = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token);
                        idle.CancelAfter(TimeSpan.FromSeconds(30));
                        var count = source.ReadAsync(buffer, idle.Token).AsTask().GetAwaiter().GetResult();
                        if (count == 0) break;
                        total += count;
                        if (total > descriptor.Size || total > ComponentCatalogValidator.MaxAssetBytes) throw new InvalidDataException("Download too large.");
                        target.Write(buffer, 0, count);
                    }
                }
                VerifyFileHash(destination, descriptor.Sha256, descriptor.Size);
                return;
            }
            catch (Exception error) when (error is HttpRequestException or IOException or OperationCanceledException)
            {
                last = error;
                if (deadline.IsCancellationRequested || error is InvalidDataException || error is HttpRequestException { StatusCode: { } code } && (int)code < 500 && code is not (System.Net.HttpStatusCode.RequestTimeout or System.Net.HttpStatusCode.TooManyRequests)) break;
                if (attempt < 2) Thread.Sleep(1000 * (attempt + 1));
            }
        }
        throw new IOException("Component download failed.", last);
    }

    private static bool ProbeUpdater(string executable, string expectedVersion)
    {
        if (!File.Exists(executable)) return false;
        try
        {
            using var probe = Process.Start(new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true, ArgumentList = { "--component-probe" } });
            if (probe is null) return false;
            var output = probe.StandardOutput.ReadToEndAsync();
            if (!probe.WaitForExit(10000)) { probe.Kill(entireProcessTree: true); return false; }
            if (probe.ExitCode != 0 || !output.Wait(1000) || output.Result.Length > 8192) return false;
            using var json = JsonDocument.Parse(output.Result);
            return json.RootElement.GetProperty("productId").GetString() == "movielist"
                && json.RootElement.GetProperty("componentId").GetString() == "updater"
                && json.RootElement.GetProperty("version").GetString() is string version
                && ComponentCatalogValidator.CompareVersions(version, expectedVersion) == 0
                && json.RootElement.GetProperty("componentProtocolVersion").GetInt32() == 1;
        }
        catch { return false; }
    }

    // Kept separate from the CLI so replacement, locked-file retry and rollback
    // can be exercised with real temporary files without installing a host.
    private static void ReplaceUpdaterFile(string candidate, string permanent, string backup, Func<string, bool> probe)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(permanent)!);
        var staged = Path.Combine(Path.GetDirectoryName(permanent)!, ".updater-replacement-" + Guid.NewGuid().ToString("N"));
        var rollback = staged + ".rollback";
        File.Copy(candidate, staged);
        try
        {
            // The fully written staging file is on the permanent file's volume.
            // File.Replace is atomic: a crash exposes the complete old or new
            // image, while the previous executable remains available for recovery.
            RetryFileMutation(() => {
                if (File.Exists(permanent)) File.Replace(staged, permanent, backup);
                else File.Move(staged, permanent);
            });
            if (!probe(permanent)) throw new InvalidDataException("Installed updater failed activation probe.");
        }
        catch
        {
            try
            {
                if (File.Exists(backup))
                {
                    File.Copy(backup, rollback);
                    RetryFileMutation(() => {
                        if (File.Exists(permanent)) File.Replace(rollback, permanent, null);
                        else File.Move(rollback, permanent);
                    });
                }
            }
            catch { throw new ComponentFailure("UPDATER_RECOVERY_REQUIRED"); }
            throw;
        }
        finally
        {
            if (File.Exists(staged)) File.Delete(staged);
            if (File.Exists(rollback)) File.Delete(rollback);
        }
    }

    private static bool VerifySuiteActivation(ComponentDescriptor descriptor, bool allowStopped = false)
    {
        try
        {
            var installed = ReadSuiteInventory();
            if (!installed.Installed || !installed.LayoutValid || installed.Version != descriptor.Version
                || (descriptor.ApiMajor is not null && installed.ApiMajor != descriptor.ApiMajor)
                || (descriptor.BuildId is not null && installed.BuildId != descriptor.BuildId)) return false;
            var port = SuiteRuntimeConfiguration.ReadPort(installed.InstallPath!);
            if (allowStopped && WindowsServiceInspector.GetTorrentService().Status == "stopped"
                && WindowsServiceInspector.NoListenerOrOrphan(installed.InstallPath!, port)) return true;
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            using var response = client.GetAsync(SuiteRuntimeConfiguration.ReadyUri(port)).GetAwaiter().GetResult();
            if (!response.IsSuccessStatusCode) return false;
            var body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            if (body.Length > 65536) return false;
            using var ready = JsonDocument.Parse(body);
            return ready.RootElement.GetProperty("version").GetString() == descriptor.Version
                && (descriptor.ApiMajor is null || ready.RootElement.GetProperty("apiMajor").GetInt32() == descriptor.ApiMajor)
                && (descriptor.BuildId is null || ready.RootElement.GetProperty("buildId").GetString() == descriptor.BuildId);
        }
        catch { return false; }
    }

    private static void RetryFileMutation(Action mutation)
    {
        for (var attempt = 0; ; attempt++)
        {
            try { mutation(); return; }
            catch (Exception error) when (attempt < 29 && error is IOException or UnauthorizedAccessException) { Thread.Sleep(1000); }
        }
    }

    private static JsonElement BrokerRequest(object request)
    {
        using var pipe = new NamedPipeClientStream(".", "MediaPlayerSuiteUpdates-v1", PipeDirection.InOut,
            PipeOptions.Asynchronous, TokenImpersonationLevel.Impersonation);
        pipe.Connect(1500);
        var body = JsonSerializer.SerializeToUtf8Bytes(request, JsonOptions);
        pipe.Write(BitConverter.GetBytes(body.Length)); pipe.Write(body); pipe.Flush();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var header = new byte[4];
        pipe.ReadExactlyAsync(header, timeout.Token).AsTask().GetAwaiter().GetResult();
        var length = BitConverter.ToInt32(header);
        if (length is <= 0 or > 256 * 1024) throw new InvalidDataException("Invalid broker response.");
        var response = new byte[length];
        pipe.ReadExactlyAsync(response, timeout.Token).AsTask().GetAwaiter().GetResult();
        using var json = JsonDocument.Parse(response);
        return json.RootElement.Clone();
    }

    private static void ProtectUserComponentDirectory(string path)
    {
        Directory.CreateDirectory(path);
        RejectReparsePoints(path);
        var security = new DirectorySecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        foreach (var sid in new[] { WindowsIdentity.GetCurrent().User!, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null) })
            security.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        new DirectoryInfo(path).SetAccessControl(security);
    }

    private static void RejectReparsePoints(string path)
    {
        for (var current = new DirectoryInfo(Path.GetFullPath(path)); current is not null; current = current.Parent)
            if ((current.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Reparse directories are not permitted.");
    }
}
