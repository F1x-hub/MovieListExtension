using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Win32;
using System.Windows.Forms;

internal static class Program
{
    private const string HostName = "com.movielist.updater";
    private const string RepositoryPrefix = "https://github.com/F1x-hub/MovieListExtension/releases/download/";
    private const string AppName = "MovieListExtensionUpdater";
    private const int ProtocolVersion = 1;
    private const string UpdaterVersion = "1.1.0";
    private const string ApplyMutexName = @"Local\MovieListExtensionUpdater.Apply";
    private const string SetupMutexName = @"Local\MovieListExtensionUpdater.Setup";
    private const string RecoveryRunOnceName = "MovieListExtensionUpdaterRecovery";
    private const string RecoveryRunOncePath = @"Software\Microsoft\Windows\CurrentVersion\RunOnce";
    private static readonly TimeSpan StaleOperationAge = TimeSpan.FromMinutes(15);
    private const long MaxDownloadBytes = 512L * 1024 * 1024;
    private const long MaxArchiveBytes = 512L * 1024 * 1024;
    private const int MaxArchiveEntries = 20_000;

    // This is a public verification key. The private signing key must remain in
    // the release environment and is never shipped to users or committed here.
    private const string ReleasePublicKey = """
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1KggugPrWU3WTlX93aro
yFFp0UxDZ22uaJaRan3lxN09fjy2WasoYfABTg6Z3dd8thgztOITK0TUbWX2+Ajn
9V7AOjJyoizOpn7yYKTunR0YhVZ+IfQ9nXUUXrS/IYP0cEIKbP8oJdSWsTTnSgXR
5WFCqA6Fz53zvhpKmJcgVJ9UIG8MayKBcbH9/hfNS8sjeT8PVzDNpWueOjhybj5C
DPVucYqmpUltXe830HRWXhffRGhQrYzYj4UXtZ5S6JyrCDa6xUbeZWFvShOBYs90
dD5ySm+NYY/xv/ToWUnVFwObVuv7GyprMZyRv6FegqUTCjaIBcvm8bS2uxWk7Jbe
xwIDAQAB
-----END PUBLIC KEY-----
""";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private static string DataRoot => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppName);

    private static string ConfigPath => Path.Combine(DataRoot, "install.json");
    private static string StatePath => Path.Combine(DataRoot, "operation.json");
    private static string InputPath(string operationId) => Path.Combine(DataRoot, $"operation-{operationId}.json");

    [STAThread]
    private static int Main(string[] args)
    {
        Directory.CreateDirectory(DataRoot);
        if (args.Length >= 2 && string.Equals(args[0], "--recover", StringComparison.OrdinalIgnoreCase))
        {
            return Guid.TryParse(args[1], out var recoveryOperationId)
                ? RecoverOperationAtLogon(recoveryOperationId.ToString("D"))
                : 1;
        }

        var setupRequested = args.Length == 0
            || args.Any(arg => string.Equals(arg, "--setup", StringComparison.OrdinalIgnoreCase));
        if (setupRequested)
        {
            using var setupMutex = new Mutex(false, SetupMutexName);
            if (!TryAcquireOperationMutex(setupMutex))
            {
                MessageBox.Show(
                    "Окно подключения MovieList уже открыто.",
                    "MovieList Extension",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return 0;
            }

            try
            {
                ApplicationConfiguration.Initialize();
                Application.Run(new SetupForm());
            }
            finally
            {
                setupMutex.ReleaseMutex();
            }
            return 0;
        }

        if (args.Length >= 2 && string.Equals(args[0], "--execute", StringComparison.OrdinalIgnoreCase))
        {
            if (!Guid.TryParse(args[1], out var operationId)) return 1;
            ExecuteOperation(operationId.ToString("D"));
            return 0;
        }

        return RunNativeHost(args);
    }

    private static int RunNativeHost(string[] args)
    {
        var config = LoadConfig();
        var callerOrigin = args
            .FirstOrDefault(arg => arg.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase))
            ?.TrimEnd('/');
        if (config is null || !string.Equals(callerOrigin, $"chrome-extension://{config.ExtensionId}", StringComparison.OrdinalIgnoreCase))
        {
            Console.Error.WriteLine("Native host caller origin was not recognized.");
            return 1;
        }

        using var input = Console.OpenStandardInput();
        using var output = Console.OpenStandardOutput();
        while (true)
        {
            var requestBytes = ReadFrame(input);
            if (requestBytes is null) return 0;

            try
            {
                using var document = JsonDocument.Parse(requestBytes);
                var response = HandleRequest(document.RootElement, config);
                WriteFrame(output, response);
            }
            catch (Exception error)
            {
                WriteFrame(output, ErrorResponse("HOST_REQUEST_FAILED", error.Message));
            }
        }
    }

    private static object HandleRequest(JsonElement request, InstallConfig config)
    {
        if (request.TryGetProperty("protocolVersion", out var protocol)
            && protocol.GetInt32() != ProtocolVersion)
        {
            return ErrorResponse("PROTOCOL_VERSION_UNSUPPORTED", "Unsupported updater protocol.");
        }

        if (request.TryGetProperty("extensionId", out var extensionId)
            && !string.Equals(extensionId.GetString(), config.ExtensionId, StringComparison.Ordinal))
        {
            return ErrorResponse("EXTENSION_ID_MISMATCH", "The extension identity does not match setup.");
        }

        var action = request.TryGetProperty("action", out var actionElement)
            ? actionElement.GetString()
            : null;

        return action switch
        {
            "status" => StatusResponse(config),
            "apply" => StartApply(request, config),
            "confirm" => Confirm(request, config),
            _ => ErrorResponse("ACTION_UNSUPPORTED", "Unsupported updater action.")
        };
    }

    private static object StatusResponse(InstallConfig config)
    {
        RecoverStaleOperationIfPossible(config);
        var operation = ReadJson<OperationState>(StatePath);
        if (operation?.CleanupPending == true)
        {
            RetryCleanup(operation);
            operation = ReadJson<OperationState>(StatePath);
        }
        var currentVersion = ReadCurrentManifestVersion(config.ExtensionPath);
        return new
        {
            success = true,
            configured = IsConfiguredExtension(config),
            installPath = config.ExtensionPath,
            extensionId = config.ExtensionId,
            extensionVersion = currentVersion?.ToString(3),
            updaterVersion = UpdaterVersion,
            operation
        };
    }

    private static object StartApply(JsonElement request, InstallConfig config)
    {
        var operationId = request.TryGetProperty("operationId", out var operationElement)
            ? operationElement.GetString()
            : null;
        var metadataText = request.TryGetProperty("metadataText", out var metadataElement)
            ? metadataElement.GetString()
            : null;
        var signature = request.TryGetProperty("signature", out var signatureElement)
            ? signatureElement.GetString()
            : null;

        if (!Guid.TryParse(operationId, out var parsedOperationId)
            || string.IsNullOrWhiteSpace(metadataText)
            || string.IsNullOrWhiteSpace(signature))
        {
            return ErrorResponse("UPDATE_REQUEST_INVALID", "The update request is incomplete.");
        }

        UpdateMetadata metadata;
        try
        {
            metadata = ParseAndValidateMetadata(metadataText, config);
        }
        catch (InvalidDataException error)
        {
            return ErrorResponse("RELEASE_METADATA_INVALID", error.Message);
        }

        if (!VerifySignature(Encoding.UTF8.GetBytes(metadataText), signature))
        {
            return ErrorResponse("UPDATE_SIGNATURE_INVALID", "The release metadata signature is invalid.");
        }

        using var operationMutex = new Mutex(false, ApplyMutexName);
        var mutexAcquired = false;
        OperationState? state = null;
        try
        {
            try
            {
                mutexAcquired = operationMutex.WaitOne(0);
            }
            catch (AbandonedMutexException)
            {
                mutexAcquired = true;
            }

            if (!mutexAcquired)
            {
                return ErrorResponse("UPDATE_IN_PROGRESS", "Another update operation is already running.");
            }

            var existing = ReadJson<OperationState>(StatePath);
            if (existing?.CleanupPending == true)
            {
                RetryCleanup(existing);
                existing = ReadJson<OperationState>(StatePath);
                if (existing?.CleanupPending == true)
                {
                    return ErrorResponse("CLEANUP_PENDING", "The previous update is still cleaning up temporary files.");
                }
            }
            if (existing is not null && string.Equals(existing.Status, "recovery_required", StringComparison.Ordinal))
            {
                return ErrorResponse(
                    "RECOVERY_REQUIRED",
                    existing.ErrorMessage ?? "The previous update requires recovery before another update can start.");
            }
            if (existing is not null && IsActiveOperation(existing))
            {
                if (!IsRecoverableStaleOperation(existing))
                {
                    return ErrorResponse("UPDATE_IN_PROGRESS", "Another update operation is already running.");
                }

                RecoverInterruptedOperation(existing, config);
                existing = ReadJson<OperationState>(StatePath);
                if (existing is not null && string.Equals(existing.Status, "recovery_required", StringComparison.Ordinal))
                {
                    return ErrorResponse(
                        "RECOVERY_REQUIRED",
                        existing.ErrorMessage ?? "The previous update requires recovery before another update can start.");
                }
            }

            var currentVersion = ReadCurrentManifestVersion(config.ExtensionPath);
            if (currentVersion is not null
                && CompareVersions(metadata.Version, currentVersion) <= 0)
            {
                return ErrorResponse("UPDATE_NOT_NEWER", "The release is not newer than the installed version.");
            }

            state = new OperationState
            {
                OperationId = parsedOperationId.ToString("D"),
                Status = "queued",
                Version = metadata.Version,
                InstallPath = config.ExtensionPath,
                StartedAt = DateTimeOffset.UtcNow,
                LastProgressAt = DateTimeOffset.UtcNow
            };
            WriteJsonAtomic(StatePath, state);
            WriteJsonAtomic(InputPath(state.OperationId), new OperationInput
            {
                MetadataText = metadataText,
                Signature = signature,
                Metadata = metadata,
                InstallPath = config.ExtensionPath
            });

            RegisterRecoveryRunOnce(state.OperationId);

            var executable = Environment.ProcessPath;
            if (string.IsNullOrWhiteSpace(executable))
            {
                return ErrorResponse("EXECUTABLE_PATH_UNKNOWN", "The updater executable path is unavailable.");
            }

            var process = Process.Start(new ProcessStartInfo
            {
                FileName = executable,
                ArgumentList = { "--execute", state.OperationId },
                UseShellExecute = false,
                CreateNoWindow = true
            });
            if (process is null)
            {
                return ErrorResponse("EXECUTOR_START_FAILED", "The update executor could not be started.");
            }

            state.ExecutorPid = process.Id;
            state.ExecutorStartedAt = TryReadProcessStartTime(process);
            state.LastProgressAt = DateTimeOffset.UtcNow;
            WriteJsonAtomic(StatePath, state);

            return new { success = true, status = state.Status, operationId = state.OperationId };
        }
        catch (Exception error)
        {
            if (state is not null)
            {
                state.Status = "failed";
                state.ErrorCode = "EXECUTOR_START_FAILED";
                state.ErrorMessage = error.Message;
                state.CleanupPending = true;
                state.LastProgressAt = DateTimeOffset.UtcNow;
                WriteJsonAtomic(StatePath, state);
                RetryCleanup(state);
                RemoveRecoveryRunOnce(state.OperationId);
            }
            return ErrorResponse("EXECUTOR_START_FAILED", error.Message);
        }
        finally
        {
            if (mutexAcquired) operationMutex.ReleaseMutex();
        }
    }

    private static object Confirm(JsonElement request, InstallConfig config)
    {
        var operationId = request.TryGetProperty("operationId", out var operationElement)
            ? operationElement.GetString()
            : null;
        var version = request.TryGetProperty("version", out var versionElement)
            ? versionElement.GetString()
            : null;
        if (!Guid.TryParse(operationId, out _))
        {
            return ErrorResponse("CONFIRMATION_INVALID", "The update operation identifier is invalid.");
        }

        using var operationMutex = new Mutex(false, ApplyMutexName);
        var mutexAcquired = false;
        try
        {
            mutexAcquired = TryAcquireOperationMutex(operationMutex);
            if (!mutexAcquired)
            {
                return ErrorResponse("UPDATE_IN_PROGRESS", "Another update operation is already running.");
            }

            var state = ReadJson<OperationState>(StatePath);
            if (state is null || !string.Equals(state.OperationId, operationId, StringComparison.Ordinal)
                || !string.Equals(state.Version, version, StringComparison.Ordinal)
                || !string.Equals(state.Status, "awaiting_confirmation", StringComparison.Ordinal))
            {
                return ErrorResponse("CONFIRMATION_INVALID", "No matching update is waiting for confirmation.");
            }

            var installedVersion = ReadCurrentManifestVersion(config.ExtensionPath);
            if (installedVersion is null || CompareVersions(version!, installedVersion) != 0)
            {
                return ErrorResponse("CONFIRMATION_INVALID", "The installed extension version does not match the update.");
            }

            state.Status = "succeeded";
            state.ConfirmedAt = DateTimeOffset.UtcNow;
            state.CleanupPending = true;
            state.LastProgressAt = DateTimeOffset.UtcNow;
            WriteJsonAtomic(StatePath, state);
            RetryCleanup(state);
            RemoveRecoveryRunOnce(state.OperationId);
            return new { success = true, status = state.Status, version = state.Version };
        }
        finally
        {
            if (mutexAcquired) operationMutex.ReleaseMutex();
        }
    }

    private static void ExecuteOperation(string operationId)
    {
        using var operationMutex = new Mutex(false, ApplyMutexName);
        var mutexAcquired = false;
        try
        {
            mutexAcquired = operationMutex.WaitOne(TimeSpan.FromSeconds(30));
            if (!mutexAcquired) return;

            var config = LoadConfig()
                ?? throw new InvalidOperationException("Updater setup is not configured.");
            var state = ReadJson<OperationState>(StatePath)
                ?? throw new InvalidOperationException("Operation state was not found.");
            if (!string.Equals(state.OperationId, operationId, StringComparison.Ordinal)
                || !string.Equals(state.Status, "queued", StringComparison.Ordinal))
            {
                return;
            }

            var input = ReadJson<OperationInput>(InputPath(operationId))
                ?? throw new InvalidOperationException("Operation input was not found.");
            if (!string.Equals(
                    Path.GetFullPath(input.InstallPath),
                    Path.GetFullPath(config.ExtensionPath),
                    StringComparison.OrdinalIgnoreCase)
                || !string.Equals(input.InstallPath, state.InstallPath, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("The operation target no longer matches setup.");
            }

            var validatedMetadata = ParseAndValidateMetadata(input.MetadataText, config);
            if (!VerifySignature(Encoding.UTF8.GetBytes(input.MetadataText), input.Signature))
            {
                throw new InvalidDataException("The operation metadata signature is invalid.");
            }
            if (!string.Equals(validatedMetadata.Version, state.Version, StringComparison.Ordinal))
            {
                throw new InvalidDataException("The operation version no longer matches signed metadata.");
            }
            input.Metadata = validatedMetadata;
            UpdateOperationState(operationId, state => state.Status = "downloading");

            var stageRoot = GetStagingPath(input.InstallPath, operationId);
            Directory.CreateDirectory(stageRoot);
            var archivePath = Path.Combine(stageRoot, input.Metadata.AssetName);
            DownloadFile(input.Metadata.AssetUrl, archivePath, input.Metadata.Size);
            VerifyFileHash(archivePath, input.Metadata.Sha256, input.Metadata.Size);

            var extractionPath = Path.Combine(stageRoot, "extension");
            Directory.CreateDirectory(extractionPath);
            ValidateArchive(archivePath);
            ZipFile.ExtractToDirectory(archivePath, extractionPath, overwriteFiles: false);
            var manifestPath = Path.Combine(extractionPath, "manifest.json");
            if (!File.Exists(manifestPath)) throw new InvalidDataException("The archive does not contain manifest.json at its root.");
            ValidateManifest(manifestPath, input.Metadata);

            UpdateOperationState(operationId, state => state.Status = "replacing");
            var recoveryPath = GetRecoveryPath(input.InstallPath, operationId);
            UpdateOperationState(operationId, state => state.RecoveryPath = recoveryPath);
            DeleteKnownDirectory(recoveryPath);
            MoveWithRetry(input.InstallPath, recoveryPath);
            try
            {
                MoveWithRetry(extractionPath, input.InstallPath);
            }
            catch
            {
                if (!Directory.Exists(input.InstallPath) && Directory.Exists(recoveryPath))
                {
                    MoveWithRetry(recoveryPath, input.InstallPath);
                }
                throw;
            }

            UpdateOperationState(operationId, state =>
            {
                state.Status = "awaiting_confirmation";
                state.ErrorCode = null;
                state.ErrorMessage = null;
            });
        }
        catch (Exception error)
        {
            try
            {
                var failedState = ReadJson<OperationState>(StatePath);
                if (failedState is not null
                    && string.Equals(failedState.OperationId, operationId, StringComparison.Ordinal)
                    && string.Equals(failedState.Status, "replacing", StringComparison.Ordinal))
                {
                    RecoverInterruptedOperation(failedState, config: LoadConfig() ?? throw new InvalidOperationException("Updater setup is not configured."));
                }
                else
                {
                    UpdateOperationState(operationId, state =>
                    {
                        state.Status = "failed";
                        state.ErrorCode = "EXECUTION_FAILED";
                        state.ErrorMessage = error.Message;
                        state.CleanupPending = true;
                    });
                    var cleanupState = ReadJson<OperationState>(StatePath);
                    if (cleanupState is not null) RetryCleanup(cleanupState);
                    RemoveRecoveryRunOnce(operationId);
                }
            }
            catch
            {
                // Keep the original executor failure from being masked by a
                // second journal failure during crash recovery.
            }
        }
        finally
        {
            if (mutexAcquired) operationMutex.ReleaseMutex();
        }
    }

    private static UpdateMetadata ParseAndValidateMetadata(string metadataText, InstallConfig config)
    {
        var metadata = JsonSerializer.Deserialize<UpdateMetadata>(metadataText, JsonOptions)
            ?? throw new InvalidDataException("Release metadata is empty.");
        var expectedAssetName = $"MovieList-extension-{metadata.Version}.zip";
        var expectedAssetUrl = $"{RepositoryPrefix}v{metadata.Version}/{expectedAssetName}";
        if (metadata.SchemaVersion != 1
            || !TryParseStableVersion(metadata.Version, out _)
            || !string.Equals(metadata.ExtensionId, config.ExtensionId, StringComparison.Ordinal)
            || !string.Equals(metadata.AssetName, expectedAssetName, StringComparison.Ordinal)
            || !string.Equals(metadata.AssetUrl, expectedAssetUrl, StringComparison.Ordinal)
            || !metadata.Sha256.All(Uri.IsHexDigit)
            || metadata.Sha256.Length != 64
            || metadata.Size <= 0
            || metadata.Size > MaxDownloadBytes
            || !TryParseStableVersion(metadata.MinUpdaterVersion, out var minUpdaterVersion))
        {
            throw new InvalidDataException("Release metadata failed validation.");
        }
        if (CompareVersions(UpdaterVersion, minUpdaterVersion) < 0)
        {
            throw new InvalidDataException($"This update requires updater {metadata.MinUpdaterVersion} or newer.");
        }
        return metadata;
    }

    private static bool VerifySignature(byte[] data, string signature)
    {
        try
        {
            using var rsa = RSA.Create();
            rsa.ImportFromPem(ReleasePublicKey);
            return rsa.VerifyData(
                data,
                Convert.FromBase64String(signature),
                HashAlgorithmName.SHA256,
                RSASignaturePadding.Pss);
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static void DownloadFile(string url, string destination, long expectedSize)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("MovieListExtensionUpdater/1.0");
        using var response = client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult();
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength is long contentLength && contentLength != expectedSize)
            throw new InvalidDataException("The response size does not match signed metadata.");

        using var source = response.Content.ReadAsStream();
        using var target = File.Create(destination);
        var buffer = new byte[64 * 1024];
        long total = 0;
        int read;
        while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
        {
            total += read;
            if (total > expectedSize || total > MaxDownloadBytes)
                throw new InvalidDataException("The downloaded file is larger than signed metadata.");
            target.Write(buffer, 0, read);
        }
        if (total != expectedSize)
            throw new InvalidDataException("The downloaded file is smaller than signed metadata.");
    }

    private static void VerifyFileHash(string path, string expectedHash, long expectedSize)
    {
        var info = new FileInfo(path);
        if (info.Length != expectedSize) throw new InvalidDataException("The downloaded size does not match metadata.");
        using var stream = File.OpenRead(path);
        var actualHash = Convert.ToHexString(SHA256.HashData(stream));
        if (!actualHash.Equals(expectedHash, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The downloaded SHA-256 does not match metadata.");
    }

    private static void ValidateArchive(string path)
    {
        using var archive = ZipFile.OpenRead(path);
        if (archive.Entries.Count == 0 || archive.Entries.Count > MaxArchiveEntries)
            throw new InvalidDataException("The archive has an invalid number of entries.");
        long totalBytes = 0;
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in archive.Entries)
        {
            var normalized = entry.FullName.Replace('\\', '/');
            if (normalized.StartsWith('/') || normalized.Split('/').Contains("..") || !names.Add(normalized))
                throw new InvalidDataException("The archive contains an unsafe or duplicate path.");
            totalBytes += entry.Length;
            if (totalBytes > MaxArchiveBytes) throw new InvalidDataException("The archive is too large after extraction.");
        }
    }

    private static void ValidateManifest(string path, UpdateMetadata metadata)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        var root = document.RootElement;
        var version = root.GetProperty("version").GetString();
        var key = root.GetProperty("key").GetString();
        if (!string.Equals(version, metadata.Version, StringComparison.Ordinal))
            throw new InvalidDataException("The archive manifest version does not match metadata.");
        if (string.IsNullOrWhiteSpace(key) || ComputeExtensionId(key) != metadata.ExtensionId)
            throw new InvalidDataException("The archive extension identity does not match metadata.");
    }

    private static bool IsActiveOperation(OperationState state)
    {
        return state.Status is "queued" or "downloading" or "replacing" or "awaiting_confirmation";
    }

    private static bool IsRecoverableStaleOperation(OperationState state)
    {
        if (state.Status is "recovery_required") return true;
        if (state.Status is not ("queued" or "downloading" or "replacing")) return false;
        var lastProgress = state.LastProgressAt == default ? state.StartedAt : state.LastProgressAt;
        return lastProgress != default
            && DateTimeOffset.UtcNow - lastProgress > StaleOperationAge
            && !IsExecutorAlive(state);
    }

    private static bool IsExecutorAlive(OperationState state)
    {
        if (state.ExecutorPid <= 0) return false;
        try
        {
            using var process = Process.GetProcessById(state.ExecutorPid);
            if (state.ExecutorStartedAt is null) return true;
            var actualStart = new DateTimeOffset(process.StartTime.ToUniversalTime());
            return Math.Abs((actualStart - state.ExecutorStartedAt.Value).TotalSeconds) < 10;
        }
        catch
        {
            return false;
        }
    }

    private static DateTimeOffset? TryReadProcessStartTime(Process process)
    {
        try
        {
            return new DateTimeOffset(process.StartTime.ToUniversalTime());
        }
        catch
        {
            return null;
        }
    }

    private static void RecoverStaleOperationIfPossible(InstallConfig config)
    {
        var state = ReadJson<OperationState>(StatePath);
        if (state is null || !IsRecoverableStaleOperation(state)) return;

        using var operationMutex = new Mutex(false, ApplyMutexName);
        if (!TryAcquireOperationMutex(operationMutex)) return;
        try
        {
            var current = ReadJson<OperationState>(StatePath);
            if (current is not null && IsRecoverableStaleOperation(current))
            {
                RecoverInterruptedOperation(current, config);
            }
        }
        finally
        {
            operationMutex.ReleaseMutex();
        }
    }

    private static void RecoverInterruptedOperation(OperationState state, InstallConfig config)
    {
        var currentVersion = ReadCurrentManifestVersion(config.ExtensionPath);
        if (currentVersion is not null && CompareVersions(state.Version, currentVersion) == 0)
        {
            state.Status = "awaiting_confirmation";
            state.ErrorCode = null;
            state.ErrorMessage = null;
            state.LastProgressAt = DateTimeOffset.UtcNow;
            WriteJsonAtomic(StatePath, state);
            RemoveRecoveryRunOnce(state.OperationId);
            return;
        }

        var recoveryPath = state.RecoveryPath ?? GetRecoveryPath(state.InstallPath, state.OperationId);
        var wasReplacing = string.Equals(state.Status, "replacing", StringComparison.Ordinal)
            || string.Equals(state.Status, "recovery_required", StringComparison.Ordinal);
        try
        {
            if (Directory.Exists(recoveryPath))
            {
                if (Directory.Exists(state.InstallPath)) DeleteKnownDirectory(state.InstallPath);
                MoveWithRetry(recoveryPath, state.InstallPath);
            }
            else if (wasReplacing && !Directory.Exists(state.InstallPath))
            {
                state.Status = "recovery_required";
                state.ErrorCode = "RECOVERY_REQUIRED";
                state.ErrorMessage = "The extension folder is missing and no recovery copy is available.";
                state.LastProgressAt = DateTimeOffset.UtcNow;
                WriteJsonAtomic(StatePath, state);
                RegisterRecoveryRunOnce(state.OperationId);
                return;
            }

            state.Status = "failed";
            state.ErrorCode = "RECOVERED_AFTER_INTERRUPTION";
            state.ErrorMessage = "The interrupted update was rolled back.";
            state.CleanupPending = true;
            state.LastProgressAt = DateTimeOffset.UtcNow;
            WriteJsonAtomic(StatePath, state);
            RetryCleanup(state);
            RemoveRecoveryRunOnce(state.OperationId);
        }
        catch (Exception error)
        {
            state.Status = "recovery_required";
            state.ErrorCode = "RECOVERY_REQUIRED";
            state.ErrorMessage = error.Message;
            state.LastProgressAt = DateTimeOffset.UtcNow;
            WriteJsonAtomic(StatePath, state);
            RegisterRecoveryRunOnce(state.OperationId);
        }
    }

    private static int RecoverOperationAtLogon(string operationId)
    {
        var config = LoadConfig();
        if (config is null) return 1;

        using var operationMutex = new Mutex(false, ApplyMutexName);
        if (!TryAcquireOperationMutex(operationMutex)) return 1;
        try
        {
            var state = ReadJson<OperationState>(StatePath);
            if (state is null || !string.Equals(state.OperationId, operationId, StringComparison.Ordinal))
            {
                RemoveRecoveryRunOnce(operationId);
                return 0;
            }

            if (IsExecutorAlive(state)) return 0;
            if (state.Status is "awaiting_confirmation" or "succeeded" or "failed")
            {
                if (state.CleanupPending) RetryCleanup(state);
                RemoveRecoveryRunOnce(operationId);
                return 0;
            }

            RecoverInterruptedOperation(state, config);
            return 0;
        }
        finally
        {
            operationMutex.ReleaseMutex();
        }
    }

    private static string GetRecoveryPath(string installPath, string operationId)
    {
        var parent = Directory.GetParent(Path.GetFullPath(installPath))?.FullName
            ?? throw new InvalidDataException("The extension install path has no parent directory.");
        return Path.Combine(parent, ".movielist-updater", "recovery", operationId);
    }

    private static string GetStagingPath(string installPath, string operationId)
    {
        var parent = Directory.GetParent(Path.GetFullPath(installPath))?.FullName
            ?? throw new InvalidDataException("The extension install path has no parent directory.");
        return Path.Combine(parent, ".movielist-updater", "staging", operationId);
    }

    private static bool CleanupOperationArtifacts(OperationState state)
    {
        var recoveryClean = false;
        var stagingClean = false;
        try
        {
            recoveryClean = TryDeleteDirectory(state.RecoveryPath ?? GetRecoveryPath(state.InstallPath, state.OperationId));
            stagingClean = TryDeleteDirectory(GetStagingPath(state.InstallPath, state.OperationId));
        }
        catch
        {
            // Keep cleanup_pending when a damaged journal cannot resolve its paths.
        }
        var inputClean = TryDeleteFile(InputPath(state.OperationId));
        return recoveryClean && stagingClean && inputClean;
    }

    private static void RetryCleanup(OperationState state)
    {
        state.CleanupPending = !CleanupOperationArtifacts(state);
        state.LastProgressAt = DateTimeOffset.UtcNow;
        WriteJsonAtomic(StatePath, state);
    }

    private static bool TryDeleteDirectory(string path)
    {
        try
        {
            DeleteKnownDirectory(path);
            return !Directory.Exists(path);
        }
        catch
        {
            return false;
        }
    }

    private static void DeleteKnownDirectory(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        var fullPath = Path.GetFullPath(path);
        if (Directory.Exists(fullPath)) Directory.Delete(fullPath, recursive: true);
    }

    private static bool TryDeleteFile(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
            return !File.Exists(path);
        }
        catch
        {
            return false;
        }
    }

    private static void RegisterRecoveryRunOnce(string operationId)
    {
        var executable = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(executable))
            throw new InvalidOperationException("The updater executable path is unavailable.");

        var escapedExecutable = executable.Replace("\"", "\\\"");
        using var key = Registry.CurrentUser.CreateSubKey(RecoveryRunOncePath)
            ?? throw new InvalidOperationException("Could not open the Windows recovery startup key.");
        key.SetValue(
            RecoveryRunOnceName,
            $"\"{escapedExecutable}\" --recover {operationId}",
            RegistryValueKind.String);
    }

    private static void RemoveRecoveryRunOnce(string operationId)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RecoveryRunOncePath, writable: true);
            if (key is null) return;
            var command = key.GetValue(RecoveryRunOnceName) as string;
            var expectedSuffix = $"--recover {operationId}";
            if (string.IsNullOrWhiteSpace(command)
                || command.EndsWith(expectedSuffix, StringComparison.OrdinalIgnoreCase))
            {
                key.DeleteValue(RecoveryRunOnceName, throwOnMissingValue: false);
            }
        }
        catch
        {
            // A stale one-shot entry is harmless; the next host status retries cleanup.
        }
    }

    private static bool TryAcquireOperationMutex(Mutex mutex)
    {
        try
        {
            return mutex.WaitOne(0);
        }
        catch (AbandonedMutexException)
        {
            return true;
        }
    }

    private static Version? ReadCurrentManifestVersion(string installPath)
    {
        try
        {
            var manifestPath = Path.Combine(installPath, "manifest.json");
            using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
            var value = document.RootElement.GetProperty("version").GetString();
            return TryParseStableVersion(value, out var version) ? version : null;
        }
        catch
        {
            return null;
        }
    }

    private static bool IsConfiguredExtension(InstallConfig config)
    {
        if (!Directory.Exists(config.ExtensionPath)) return false;
        try
        {
            var manifestPath = Path.Combine(config.ExtensionPath, "manifest.json");
            using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
            var key = document.RootElement.GetProperty("key").GetString();
            return !string.IsNullOrWhiteSpace(key)
                && string.Equals(ComputeExtensionId(key), config.ExtensionId, StringComparison.Ordinal)
                && ReadCurrentManifestVersion(config.ExtensionPath) is not null;
        }
        catch
        {
            return false;
        }
    }

    private static bool TryParseStableVersion(string? value, out Version version)
    {
        version = new Version(0, 0, 0);
        if (string.IsNullOrWhiteSpace(value)
            || !System.Text.RegularExpressions.Regex.IsMatch(value, "^\\d+\\.\\d+\\.\\d+$"))
        {
            return false;
        }

        if (!Version.TryParse(value, out var parsed)) return false;
        version = parsed;
        return true;
    }

    private static int CompareVersions(string first, Version second)
    {
        return Version.Parse(first).CompareTo(second);
    }

    private static string ComputeExtensionId(string publicKey)
    {
        var hash = SHA256.HashData(Convert.FromBase64String(publicKey));
        var builder = new StringBuilder(32);
        foreach (var value in hash.Take(16))
        {
            builder.Append((char)('a' + (value >> 4)));
            builder.Append((char)('a' + (value & 0x0F)));
        }
        return builder.ToString();
    }

    private static void MoveWithRetry(string source, string destination)
    {
        Exception? last = null;
        for (var attempt = 0; attempt < 8; attempt += 1)
        {
            try
            {
                if (Directory.Exists(destination) || File.Exists(destination))
                    throw new IOException($"Destination already exists: {destination}");
                Directory.Move(source, destination);
                return;
            }
            catch (Exception error)
            {
                last = error;
                Thread.Sleep(1000);
            }
        }
        throw new IOException("Could not move the extension directory after retries.", last);
    }

    private static void UpdateOperationState(string operationId, Action<OperationState> update)
    {
        var state = ReadJson<OperationState>(StatePath);
        if (state is null || !string.Equals(state.OperationId, operationId, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("The update operation journal no longer matches the executor.");
        }
        update(state);
        state.LastProgressAt = DateTimeOffset.UtcNow;
        WriteJsonAtomic(StatePath, state);
    }

    private static Version? ReadUpdaterVersion(string path)
    {
        try
        {
            if (!File.Exists(path)) return null;
            var fileVersion = FileVersionInfo.GetVersionInfo(path).ProductVersion
                ?? FileVersionInfo.GetVersionInfo(path).FileVersion;
            var normalized = fileVersion?.Split('+', 2)[0];
            return TryParseStableVersion(normalized, out var version) ? version : null;
        }
        catch
        {
            return null;
        }
    }

    private static void CopyExecutableWithRetry(string source, string destination)
    {
        Exception? last = null;
        var temporary = destination + ".new-" + Guid.NewGuid().ToString("N");
        try
        {
            File.Copy(source, temporary, overwrite: true);
            for (var attempt = 0; attempt < 8; attempt += 1)
            {
                try
                {
                    File.Move(temporary, destination, overwrite: true);
                    return;
                }
                catch (Exception error)
                {
                    last = error;
                    Thread.Sleep(500);
                }
            }
        }
        finally
        {
            TryDeleteFile(temporary);
        }

        throw new IOException("Could not replace the installed updater executable.", last);
    }

    private static InstallConfig? LoadConfig() => ReadJson<InstallConfig>(ConfigPath);

    private static T? ReadJson<T>(string path)
    {
        if (!File.Exists(path)) return default;
        try { return JsonSerializer.Deserialize<T>(File.ReadAllText(path), JsonOptions); }
        catch { return default; }
    }

    private static void WriteJsonAtomic<T>(string path, T value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + ".tmp-" + Guid.NewGuid().ToString("N");
        File.WriteAllText(temporary, JsonSerializer.Serialize(value, JsonOptions), new UTF8Encoding(false));
        File.Move(temporary, path, overwrite: true);
    }

    private static byte[]? ReadFrame(Stream input)
    {
        var header = new byte[4];
        var firstByte = input.ReadByte();
        if (firstByte < 0) return null;
        header[0] = (byte)firstByte;
        if (!ReadExactly(input, header, 1)) throw new EndOfStreamException("Native message header ended early.");
        var length = BitConverter.ToInt32(header, 0);
        if (length <= 0 || length > 64 * 1024 * 1024) throw new InvalidDataException("Invalid native message length.");
        var body = new byte[length];
        if (!ReadExactly(input, body, 0)) throw new EndOfStreamException("Native message ended early.");
        return body;
    }

    private static void WriteFrame(Stream output, object response)
    {
        var body = JsonSerializer.SerializeToUtf8Bytes(response, JsonOptions);
        output.Write(BitConverter.GetBytes(body.Length));
        output.Write(body);
        output.Flush();
    }

    private static bool ReadExactly(Stream input, byte[] buffer, int offset)
    {
        while (offset < buffer.Length)
        {
            var count = input.Read(buffer, offset, buffer.Length - offset);
            if (count == 0) return false;
            offset += count;
        }
        return true;
    }

    private static object ErrorResponse(string code, string message) => new
    {
        success = false,
        errorCode = code,
        error = message
    };

    private sealed class SetupForm : Form
    {
        private readonly TextBox pathBox = new() { Dock = DockStyle.Fill };
        private readonly Label status = new()
        {
            AutoSize = true,
            MaximumSize = new Size(560, 0),
            Dock = DockStyle.Fill,
            Padding = new Padding(0, 16, 0, 0),
            ForeColor = Color.FromArgb(70, 70, 70),
            Text = "Готово к подключению."
        };

        public SetupForm()
        {
            Text = "MovieList Extension — установка обновлений";
            Width = 620;
            Height = 360;
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(620, 360);
            pathBox.Text = LoadConfig()?.ExtensionPath ?? string.Empty;

            var title = new Label
            {
                Text = "Подключение автоматических обновлений",
                AutoSize = true,
                Font = new Font(Font, FontStyle.Bold),
                Dock = DockStyle.Top,
                Padding = new Padding(0, 0, 0, 12)
            };
            var description = new Label
            {
                Text = "Выберите папку, которую вы загрузили в Chrome через «Загрузить распакованное расширение». Это действие нужно выполнить один раз.",
                AutoSize = true,
                MaximumSize = new Size(560, 0),
                Dock = DockStyle.Top,
                Padding = new Padding(0, 0, 0, 14)
            };
            var browse = new Button { Text = "Обзор…", AutoSize = true };
            browse.Click += (_, _) => Browse();
            var pathRow = new TableLayoutPanel { Dock = DockStyle.Top, ColumnCount = 2, AutoSize = true };
            pathRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            pathRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            pathRow.Controls.Add(pathBox, 0, 0);
            pathRow.Controls.Add(browse, 1, 0);

            var install = new Button { Text = "Подключить", AutoSize = true };
            install.Click += (_, _) => Install();
            var chrome = new Button { Text = "Открыть chrome://extensions", AutoSize = true };
            chrome.Click += (_, _) => Process.Start(new ProcessStartInfo("chrome://extensions") { UseShellExecute = true });
            var buttons = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(0, 16, 0, 0) };
            buttons.Controls.Add(install);
            buttons.Controls.Add(chrome);

            var panel = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), RowCount = 5 };
            panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            panel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            panel.Controls.Add(title, 0, 0);
            panel.Controls.Add(description, 0, 1);
            panel.Controls.Add(pathRow, 0, 2);
            panel.Controls.Add(buttons, 0, 3);
            panel.Controls.Add(status, 0, 4);
            Controls.Add(panel);
        }

        private void Browse()
        {
            using var dialog = new FolderBrowserDialog { Description = "Выберите папку распакованного расширения" };
            if (dialog.ShowDialog(this) == DialogResult.OK) pathBox.Text = dialog.SelectedPath;
        }

        private void Install()
        {
            using var operationMutex = new Mutex(false, ApplyMutexName);
            if (!TryAcquireOperationMutex(operationMutex))
            {
                status.ForeColor = Color.Firebrick;
                status.Text = "Сейчас уже выполняется обновление. Повторите подключение после его завершения.";
                return;
            }

            try
            {
                var extensionPath = Path.GetFullPath(pathBox.Text.Trim());
                var manifestPath = Path.Combine(extensionPath, "manifest.json");
                if (!File.Exists(manifestPath)) throw new InvalidDataException("В выбранной папке нет manifest.json.");
                using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
                var key = document.RootElement.GetProperty("key").GetString();
                if (string.IsNullOrWhiteSpace(key)) throw new InvalidDataException("В manifest.json нет стабильного key.");
                var extensionId = ComputeExtensionId(key);
                var existingOperation = ReadJson<OperationState>(StatePath);
                if (existingOperation is not null
                    && IsActiveOperation(existingOperation)
                    && !string.Equals(
                        Path.GetFullPath(existingOperation.InstallPath),
                        extensionPath,
                        StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException("Нельзя сменить папку во время активного обновления.");
                }
                var config = new InstallConfig { ExtensionPath = extensionPath, ExtensionId = extensionId, SetupVersion = UpdaterVersion, HostVersion = UpdaterVersion };
                var permanentExecutable = Path.Combine(DataRoot, "MovieListUpdater.exe");
                var runningExecutable = Environment.ProcessPath
                    ?? throw new InvalidOperationException("The setup executable path is unavailable.");
                var runningVersion = ReadUpdaterVersion(runningExecutable) ?? Version.Parse(UpdaterVersion);
                var installedVersion = ReadUpdaterVersion(permanentExecutable);
                if (installedVersion is not null && installedVersion.CompareTo(runningVersion) > 0)
                {
                    throw new InvalidOperationException($"Уже установлена более новая версия обновлятора ({installedVersion}). Запустите новый MovieListSetup.exe.");
                }
                if (!string.Equals(Path.GetFullPath(runningExecutable), Path.GetFullPath(permanentExecutable), StringComparison.OrdinalIgnoreCase))
                {
                    if (installedVersion is null || runningVersion.CompareTo(installedVersion) > 0)
                    {
                        CopyExecutableWithRetry(runningExecutable, permanentExecutable);
                    }
                }
                WriteJsonAtomic(ConfigPath, config);
                var hostManifestPath = Path.Combine(DataRoot, HostName + ".json");
                WriteJsonAtomic(hostManifestPath, new
                {
                    name = HostName,
                    description = "MovieList Extension updater",
                    path = permanentExecutable,
                    type = "stdio",
                    allowed_origins = new[] { $"chrome-extension://{extensionId}/" }
                });
                RegisterNativeMessagingHost("Google\\Chrome", hostManifestPath);
                RegisterNativeMessagingHost("Microsoft\\Edge", hostManifestPath);

                try
                {
                    Clipboard.SetText(extensionPath);
                }
                catch
                {
                    // Clipboard access is only a convenience and must not make setup look failed.
                }

                status.ForeColor = Color.DarkGreen;
                status.Text = $"Готово. ID расширения: {extensionId}. Путь скопирован в буфер обмена. Теперь загрузите эту папку в Chrome и откройте расширение один раз.";
                MessageBox.Show(
                    this,
                    "Автоматические обновления подключены. Теперь загрузите выбранную папку в Chrome через «Загрузить распакованное расширение».",
                    "Готово",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            catch (Exception error)
            {
                status.ForeColor = Color.Firebrick;
                status.Text = "Не удалось подключить обновления: " + error.Message;
                MessageBox.Show(this, status.Text, "Ошибка подключения", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                operationMutex.ReleaseMutex();
            }
        }

    }

    private static void RegisterNativeMessagingHost(string browserRegistryPath, string manifestPath)
    {
        using var keyHandle = Registry.CurrentUser.CreateSubKey(
            $"Software\\{browserRegistryPath}\\NativeMessagingHosts\\{HostName}");
        keyHandle?.SetValue(null, manifestPath);
    }

    private sealed class InstallConfig
    {
        public string ExtensionPath { get; set; } = string.Empty;
        public string ExtensionId { get; set; } = string.Empty;
        public string SetupVersion { get; set; } = string.Empty;
        public string HostVersion { get; set; } = string.Empty;
    }

    private sealed class OperationInput
    {
        public string MetadataText { get; set; } = string.Empty;
        public string Signature { get; set; } = string.Empty;
        public UpdateMetadata Metadata { get; set; } = new();
        public string InstallPath { get; set; } = string.Empty;
    }

    private sealed class OperationState
    {
        public string OperationId { get; set; } = string.Empty;
        public string Status { get; set; } = "idle";
        public string Version { get; set; } = string.Empty;
        public string InstallPath { get; set; } = string.Empty;
        public string? ErrorCode { get; set; }
        public string? ErrorMessage { get; set; }
        public DateTimeOffset StartedAt { get; set; }
        public DateTimeOffset LastProgressAt { get; set; }
        public int ExecutorPid { get; set; }
        public DateTimeOffset? ExecutorStartedAt { get; set; }
        public string? RecoveryPath { get; set; }
        public DateTimeOffset? ConfirmedAt { get; set; }
        public bool CleanupPending { get; set; }
    }

    private sealed class UpdateMetadata
    {
        public int SchemaVersion { get; set; }
        public string ExtensionId { get; set; } = string.Empty;
        public string Version { get; set; } = string.Empty;
        public string AssetName { get; set; } = string.Empty;
        public string AssetUrl { get; set; } = string.Empty;
        public string Sha256 { get; set; } = string.Empty;
        public long Size { get; set; }
        public string MinUpdaterVersion { get; set; } = string.Empty;
        public string PublishedAt { get; set; } = string.Empty;
    }
}
