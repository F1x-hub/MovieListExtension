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
        // True only for an explicit user install/repair: a full interactive Setup
        // may then run for an absent or unversioned Suite.
        public bool Install { get; set; }
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
        public bool Install { get; set; }
        // Mirrored from the Suite maintenance broker so the hub and the
        // extension show the real phase and download progress.
        public bool Broker { get; set; }
        public string? BrokerPhase { get; set; }
        public long? DownloadedBytes { get; set; }
        public long? TotalBytes { get; set; }
    }

    private sealed record SuiteInventory(bool Installed, bool LayoutValid, string? InstallPath,
        string? Version, int? ApiMajor, string? BuildId, string Status, bool BrokerAvailable,
        bool? Running = null, bool Ready = false, string ServiceStatus = "unknown", int? Port = null);

    private static ComponentOperation? ReadComponentOperation() => ReadJson<ComponentOperation>(ComponentStatePath);
    private static bool IsComponentOperationPending(ComponentOperation? operation) => operation?.Status is
        "queued" or "downloading" or "replacing" or "installing" or "verifying" or "recovery_required";
    // Running states hold the per-user apply mutex in a live worker; recovery
    // waits for a user decision and must not block unrelated updates.
    private static bool IsComponentOperationRunning(ComponentOperation? operation) => operation?.Status is
        "queued" or "downloading" or "replacing" or "installing" or "verifying";

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
        // Legacy installations keep a user-writable configuration that is never
        // trusted; status must still answer, so readiness falls back to the
        // default port that MovieList itself uses when no trusted port exists.
        int? port = null;
        try { port = SuiteRuntimeConfiguration.ReadPort(root); }
        catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException or InvalidOperationException) { }
        var ready = false;
        if (running == true)
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
                using var response = client.GetAsync(SuiteRuntimeConfiguration.ReadyUri(port ?? 3000)).GetAwaiter().GetResult();
                ready = response.IsSuccessStatusCode;
            }
            catch (Exception error) when (error is HttpRequestException or OperationCanceledException or IOException or UnauthorizedAccessException) { }
        }
        return new(true, layout, root, version, api, build,
            !layout ? "installation_invalid" : version is null ? "migration_required" : "installed", broker, running, ready, service.Status, port);
    }

    private static object StartComponentApply(JsonElement request)
    {
        var id = request.TryGetProperty("componentId", out var component) ? component.GetString() : null;
        var operationId = request.TryGetProperty("operationId", out var op) ? op.GetString() : null;
        var text = request.TryGetProperty("metadataText", out var metadata) ? metadata.GetString() : null;
        var signature = request.TryGetProperty("signature", out var sig) ? sig.GetString() : null;
        var install = request.TryGetProperty("install", out var installElement) && installElement.ValueKind == JsonValueKind.True;
        return StartComponentApplyCore(id, operationId, text, signature, install);
    }

    internal static object StartComponentApplyCore(string? id, string? operationId, string? text, string? signature, bool install)
    {
        if (id is not ("updater" or "mediaPlayerSuite") || !Guid.TryParse(operationId, out var parsed)
            || text is null || signature is null)
            return ErrorResponse("COMPONENT_REQUEST_INVALID", "Invalid component request.");
        install = install && id == "mediaPlayerSuite";
        operationId = parsed.ToString("D");
        using var mutex = new Mutex(false, UserApplyMutexName);
        if (!TryAcquireOperationMutex(mutex)) return ErrorResponse("UPDATE_IN_PROGRESS", "Another update is running.");
        try
        {
            var catalog = ComponentCatalogValidator.Validate(text, signature, ReleasePublicKey);
            if (!catalog.Components.TryGetValue(id, out var descriptor)) throw new InvalidDataException("Missing component.");
            var current = ReadComponentOperation();
            if (current is not null && ReconcileSuiteRepair(current)) current = ReadComponentOperation();
            if (current?.OperationId == operationId && IsComponentOperationPending(current))
                return new { success = true, operationId, status = current.Status };
            // A recovery_required journal is replaced by an explicit new attempt:
            // re-running the signed Setup is the documented Suite recovery path.
            if (IsComponentOperationRunning(current))
                return ErrorResponse("UPDATE_IN_PROGRESS", "Another component is running.");
            var extensionOperation = ReadJson<OperationState>(StatePath);
            if (extensionOperation is not null && IsExpiredConfirmation(extensionOperation))
            {
                CloseAwaitingConfirmation(extensionOperation, "CONFIRMATION_EXPIRED", "The installed version was never confirmed by the browser.");
                extensionOperation = ReadJson<OperationState>(StatePath);
            }
            if (extensionOperation?.Status is "queued" or "downloading" or "replacing" or "awaiting_confirmation"
                || extensionOperation?.CleanupPending == true)
                return ErrorResponse("UPDATE_IN_PROGRESS", "An extension update needs completion.");
            ValidateComponentActivation(id, descriptor, install);
            ProtectUserComponentDirectory(ComponentRoot);
            ComponentWorkCache.Prune(ComponentRoot, current is null ? [] : [current.OperationId], DateTimeOffset.UtcNow);
            var work = ComponentWork(operationId);
            if (Directory.Exists(work)) return ErrorResponse("OPERATION_ID_REUSED", "Use a new operation identity.");
            ProtectUserComponentDirectory(work);
            WriteJsonAtomic(Path.Combine(work, "input.json"), new ComponentInput { ComponentId = id, MetadataText = text, Signature = signature, Install = install });
            var worker = Path.Combine(work, "worker.exe");
            File.Copy(Environment.ProcessPath ?? throw new IOException("Missing host executable."), worker);
            var state = new ComponentOperation { OperationId = operationId, ComponentId = id, Version = descriptor.Version, Install = install };
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

    private static void ValidateComponentActivation(string id, ComponentDescriptor descriptor, bool install = false)
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
        if (descriptor.ApiMajor is not null && descriptor.ApiMajor != 1) throw new ComponentFailure("SUITE_API_UNSUPPORTED");
        if (install && RequiresFullSuiteSetup(suite)) return;
        if (!suite.Installed) throw new ComponentFailure("SUITE_NOT_INSTALLED");
        if (!suite.LayoutValid) throw new ComponentFailure("SUITE_INSTALLATION_INVALID");
        if (suite.Version is null) throw new ComponentFailure("SUITE_MIGRATION_REQUIRED");
        if (ComponentCatalogValidator.CompareVersions(descriptor.Version, suite.Version) <= 0)
            throw new ComponentFailure("COMPONENT_NOT_NEWER");
    }

    // Absent, damaged or legacy (no committed version marker) Suites cannot use
    // the silent UPGRADEONLY path; only the interactive full Setup repairs them.
    private static bool RequiresFullSuiteSetup(SuiteInventory suite) =>
        !suite.Installed || !suite.LayoutValid || suite.Version is null;

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
            ValidateComponentActivation(input.ComponentId, descriptor, input.Install);
            if (input.ComponentId == "mediaPlayerSuite" && input.Install && RequiresFullSuiteSetup(ReadSuiteInventory()))
            {
                SetComponentPhase(state, "downloading");
                DownloadComponentFile(descriptor, candidate);
                SetComponentPhase(state, "installing");
                RunFullSuiteSetup(candidate);
                SetComponentPhase(state, "verifying");
                if (!WaitForSuiteActivation(descriptor, TimeSpan.FromMinutes(3))) throw new ComponentFailure("SUITE_VERSION_MISMATCH");
                FinishComponent(state, "succeeded");
                return 0;
            }
            if (input.ComponentId == "mediaPlayerSuite")
            {
                var suite = ReadSuiteInventory();
                if (suite.BrokerAvailable)
                {
                    state.Broker = true;
                    SetComponentPhase(state, "queued");
                    var broker = BrokerRequest(new { action = "apply", operationId = id, metadataText = input.MetadataText, signature = input.Signature });
                    if (!broker.TryGetProperty("success", out var ok) || !ok.GetBoolean()) throw new ComponentFailure("SUITE_BROKER_REJECTED");
                    // The broker's own download deadline follows the asset size (up
                    // to 6 hours on slow links); only a broker that stops reporting
                    // anything for 20 minutes is treated as stalled.
                    var lastActivity = DateTimeOffset.UtcNow;
                    string? lastMarker = null;
                    var operation = PollSuiteBroker(id, () => BrokerRequest(new { action = "status" }), DateTimeOffset.UtcNow.AddHours(7),
                        () => DateTimeOffset.UtcNow, Thread.Sleep, observed => {
                            if (observed.TryGetProperty("wasRunning", out var running) && running.ValueKind is JsonValueKind.True or JsonValueKind.False)
                                state.WasRunning = running.GetBoolean();
                            var marker = MirrorBrokerPhase(state, observed);
                            SetComponentPhase(state, state.Status);
                            if (marker != lastMarker) { lastMarker = marker; lastActivity = DateTimeOffset.UtcNow; }
                            else if (DateTimeOffset.UtcNow - lastActivity > TimeSpan.FromMinutes(20)) throw new ComponentFailure("SUITE_BROKER_TIMEOUT");
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
            ValidateComponentActivation(input.ComponentId, descriptor, input.Install);
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
                // Setup elevates itself (PrivilegesRequired=admin), so it keeps the
                // original user identity; a pre-elevated hidden "runas" did not.
                var start = new ProcessStartInfo(candidate) { UseShellExecute = true };
                foreach (var argument in new[] { "/UPGRADEONLY=1", "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", "/DIR=" + suite.InstallPath }) start.ArgumentList.Add(argument);
                using var process = StartInstaller(start);
                if (!process.WaitForExit(10 * 60 * 1000)) throw new ComponentFailure("SUITE_INSTALL_TIMEOUT");
                if (process.ExitCode != 0) throw new ComponentFailure(InstallerExitCode(process.ExitCode));
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

    // Maps the broker phase onto the journal statuses the extension understands
    // (without persisting it) and returns a marker that changes whenever the
    // broker makes progress.
    private static string MirrorBrokerPhase(ComponentOperation state, JsonElement observed)
    {
        var phase = observed.TryGetProperty("status", out var value) ? value.GetString() : null;
        long? Number(string name) => observed.TryGetProperty(name, out var item) && item.ValueKind == JsonValueKind.Number ? item.GetInt64() : null;
        state.BrokerPhase = phase;
        state.DownloadedBytes = phase == "downloading" ? Number("downloadedBytes") : null;
        state.TotalBytes = phase == "downloading" ? Number("totalBytes") : null;
        state.Status = phase switch
        {
            "queued" => "queued",
            "downloading" => "downloading",
            "draining" or "installing" => "installing",
            "verifying" => "verifying",
            _ => state.Status
        };
        var updatedAt = observed.TryGetProperty("updatedAt", out var stamp) ? stamp.ToString() : "";
        return $"{phase}|{state.DownloadedBytes}|{updatedAt}";
    }

    private static Process StartInstaller(ProcessStartInfo start)
    {
        try { return Process.Start(start) ?? throw new ComponentFailure("SUITE_INSTALLER_START_FAILED"); }
        catch (System.ComponentModel.Win32Exception error) when (error.NativeErrorCode == 1223)
        {
            throw new ComponentFailure("ELEVATION_DECLINED");
        }
    }

    // Inno Setup exit codes: 1/2 = cancelled before or during the wizard, 5 = user abort.
    private static string InstallerExitCode(int exitCode) => exitCode switch
    {
        1 or 2 or 5 => "SUITE_INSTALL_CANCELLED",
        _ => "SUITE_INSTALL_FAILED"
    };

    // The full wizard is interactive: it chooses the folder, pairs the
    // original user and proposes legacy migration out of user-owned folders.
    private static void RunFullSuiteSetup(string installer)
    {
        using var process = StartInstaller(new ProcessStartInfo(installer) { UseShellExecute = true });
        if (!process.WaitForExit(60 * 60 * 1000)) throw new ComponentFailure("SUITE_INSTALL_TIMEOUT");
        if (process.ExitCode != 0) throw new ComponentFailure(InstallerExitCode(process.ExitCode));
    }

    private static bool WaitForSuiteActivation(ComponentDescriptor descriptor, TimeSpan timeout)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;
        while (true)
        {
            if (VerifySuiteActivation(descriptor)) return true;
            if (DateTimeOffset.UtcNow >= deadline) return false;
            Thread.Sleep(2000);
        }
    }

    // Lets the user leave a component journal that waits for repair or failed.
    // It never interrupts a worker: running workers hold the apply mutex.
    private static object DismissComponentOperation(JsonElement request)
    {
        var operationId = request.TryGetProperty("operationId", out var op) ? op.GetString() : null;
        return DismissComponentOperationCore(operationId);
    }

    internal static object DismissComponentOperationCore(string? operationId)
    {
        using var mutex = new Mutex(false, UserApplyMutexName);
        if (!TryAcquireOperationMutex(mutex)) return ErrorResponse("UPDATE_IN_PROGRESS", "A component worker is running.");
        try
        {
            var state = ReadComponentOperation();
            if (state is null || state.OperationId != operationId || state.Status is not ("recovery_required" or "failed"))
                return ErrorResponse("DISMISS_INVALID", "No matching component operation can be dismissed.");
            if (state.ComponentId == "mediaPlayerSuite" && state.Status == "recovery_required")
            {
                try
                {
                    var broker = BrokerRequest(new { action = "status" });
                    if (broker.TryGetProperty("operation", out var brokerOperation) && brokerOperation.ValueKind == JsonValueKind.Object
                        && brokerOperation.GetProperty("operationId").GetString() == state.OperationId
                        && brokerOperation.GetProperty("status").GetString() is not ("succeeded" or "failed" or "deferred"))
                        return ErrorResponse("UPDATE_IN_PROGRESS", "The Suite maintenance service is still working.");
                }
                catch (Exception error) when (error is IOException or TimeoutException or OperationCanceledException or JsonException or KeyNotFoundException or InvalidOperationException) { }
            }
            state.RecoveryErrorCode ??= state.ErrorCode;
            FinishComponent(state, "dismissed", state.ErrorCode);
            return new { success = true, operationId = state.OperationId, status = "dismissed" };
        }
        finally { mutex.ReleaseMutex(); }
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

    // Same policy as the Suite broker: about 48 KB/s, 30 minutes to 6 hours, so a
    // slow link finishes instead of failing at a fixed deadline.
    internal static TimeSpan ComponentDownloadDeadline(long size) => TimeSpan.FromSeconds(
        Math.Clamp(size / (48.0 * 1024), TimeSpan.FromMinutes(30).TotalSeconds, TimeSpan.FromHours(6).TotalSeconds));

    private static void DownloadComponentFile(ComponentDescriptor descriptor, string destination)
    {
        using var deadline = new CancellationTokenSource(ComponentDownloadDeadline(descriptor.Size));
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
                        idle.CancelAfter(TimeSpan.FromSeconds(60));
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
