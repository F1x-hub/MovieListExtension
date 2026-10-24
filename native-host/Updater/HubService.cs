using System.IO.Compression;
using System.Text;
using System.Text.Json;

// MovieList Hub actions shared by the hub window. The extension still decides
// when the extension itself updates; the hub only installs it the first time,
// connects folders and starts explicit component installs or updates.
internal static partial class Program
{
    private const string ReleaseLatestRoot = "https://github.com/F1x-hub/MovieListExtension/releases/latest/download/";
    private const string MirrorLatestRoot = "https://movielistdb-13208-updates.web.app/updates/latest/";
    private const int MaxFeedBytes = 128 * 1024;

    internal static string DefaultExtensionFolder => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MovieList", "Extension");

    internal sealed record SignedDocument(string Text, string Signature);

    internal sealed class HubFeeds
    {
        public SignedDocument? Extension { get; init; }
        public string? ExtensionVersion { get; init; }
        public string? ExtensionError { get; init; }
        public SignedDocument? Catalog { get; init; }
        public SignedComponentCatalog? ParsedCatalog { get; init; }
        public string? CatalogError { get; init; }
    }

    // Both feeds are verified against the embedded release key before any field
    // is trusted. A missing component catalog is reported, not treated as fatal.
    internal static HubFeeds FetchHubFeeds()
    {
        SignedDocument? extension = null;
        string? extensionVersion = null, extensionError = null;
        foreach (var root in new[] { ReleaseLatestRoot, MirrorLatestRoot })
        {
            try
            {
                var document = FetchSignedDocument(root + "update.json");
                var metadata = ValidateSignedExtensionMetadata(document);
                extension = document;
                extensionVersion = metadata.Version;
                extensionError = null;
                break;
            }
            catch (Exception error) when (error is HttpRequestException or IOException or InvalidDataException
                or OperationCanceledException or JsonException)
            {
                extensionError = DescribeFeedError(error);
            }
        }

        SignedDocument? catalog = null;
        SignedComponentCatalog? parsed = null;
        string? catalogError = null;
        try
        {
            catalog = FetchSignedDocument(ReleaseLatestRoot + "components.json");
            parsed = ComponentCatalogValidator.Validate(catalog.Text, catalog.Signature, ReleasePublicKey);
        }
        catch (HttpRequestException error) when (error.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            catalog = null;
            catalogError = "CATALOG_NOT_PUBLISHED";
        }
        catch (Exception error) when (error is HttpRequestException or IOException or InvalidDataException
            or OperationCanceledException or JsonException)
        {
            catalog = null;
            parsed = null;
            catalogError = DescribeFeedError(error);
        }
        return new HubFeeds
        {
            Extension = extension, ExtensionVersion = extensionVersion, ExtensionError = extensionError,
            Catalog = catalog, ParsedCatalog = parsed, CatalogError = catalogError
        };
    }

    private static string DescribeFeedError(Exception error) => error switch
    {
        HttpRequestException { StatusCode: { } status } => $"HTTP_{(int)status}",
        HttpRequestException or OperationCanceledException => "NETWORK_UNAVAILABLE",
        InvalidDataException or JsonException => "FEED_INVALID",
        _ => "FEED_UNAVAILABLE"
    };

    private static SignedDocument FetchSignedDocument(string url)
    {
        var text = FetchSmallText(url);
        var signature = FetchSmallText(url + ".sig").Trim();
        return new SignedDocument(text, signature);
    }

    private static string FetchSmallText(string url)
    {
        Exception? last = null;
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
                client.DefaultRequestHeaders.UserAgent.ParseAdd("MovieListHub/" + UpdaterVersion);
                using var response = client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult();
                if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
                    throw new HttpRequestException("Not found.", null, response.StatusCode);
                response.EnsureSuccessStatusCode();
                if (response.Content.Headers.ContentLength > MaxFeedBytes) throw new InvalidDataException("Feed is too large.");
                var bytes = response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult();
                if (bytes.Length > MaxFeedBytes) throw new InvalidDataException("Feed is too large.");
                return new UTF8Encoding(false, true).GetString(bytes);
            }
            catch (HttpRequestException error) when (error.StatusCode is { } status
                && (int)status < 500 && (int)status != 408 && (int)status != 429)
            {
                throw;
            }
            catch (Exception error) when (error is HttpRequestException or OperationCanceledException or IOException)
            {
                last = error;
                if (attempt < 3) Thread.Sleep(TimeSpan.FromSeconds(attempt));
            }
        }
        throw last ?? new IOException("Feed request failed.");
    }

    // First installs have no configuration yet; the signed metadata itself names
    // the extension identity, and the downloaded manifest key must match it.
    private static UpdateMetadata ValidateSignedExtensionMetadata(SignedDocument document)
    {
        if (!VerifySignature(Encoding.UTF8.GetBytes(document.Text), document.Signature))
            throw new InvalidDataException("The release metadata signature is invalid.");
        using var json = JsonDocument.Parse(document.Text);
        var extensionId = json.RootElement.TryGetProperty("extensionId", out var id) ? id.GetString() : null;
        if (string.IsNullOrWhiteSpace(extensionId)) throw new InvalidDataException("Release metadata has no extension identity.");
        var config = LoadConfig();
        if (config is not null && !string.Equals(config.ExtensionId, extensionId, StringComparison.Ordinal))
            throw new InvalidDataException("Release metadata belongs to another extension identity.");
        return ParseAndValidateMetadata(document.Text, new InstallConfig { ExtensionId = extensionId });
    }

    internal static object HubStatus(HubFeeds? feeds)
    {
        var config = LoadConfig();
        var extensionOperation = ReadJson<OperationState>(StatePath);
        var installedVersion = config is null ? null : ReadCurrentManifestVersion(config.ExtensionPath)?.ToString();
        var catalog = feeds?.ParsedCatalog;
        ComponentDescriptor? Descriptor(string id) =>
            catalog is not null && catalog.Components.TryGetValue(id, out var value) ? value : null;
        var suite = ReadSuiteInventory();
        var installedHub = ReadUpdaterVersion(PermanentUpdater)?.ToString(3);
        return new
        {
            success = true,
            hub = new
            {
                runningVersion = UpdaterVersion,
                installedVersion = installedHub,
                installed = installedHub is not null,
                latestVersion = Descriptor("updater")?.Version,
                runningFromInstall = string.Equals(Path.GetFullPath(Environment.ProcessPath ?? ""),
                    Path.GetFullPath(PermanentUpdater), StringComparison.OrdinalIgnoreCase)
            },
            extension = new
            {
                configured = config is not null && IsConfiguredExtension(config),
                path = config?.ExtensionPath,
                defaultPath = DefaultExtensionFolder,
                extensionId = config?.ExtensionId,
                installedVersion,
                latestVersion = feeds?.ExtensionVersion,
                feedError = feeds?.ExtensionError,
                operation = extensionOperation is null ? null : new
                {
                    extensionOperation.OperationId, extensionOperation.Status, extensionOperation.Version,
                    extensionOperation.ErrorCode, extensionOperation.ErrorMessage
                }
            },
            player = new
            {
                suite.Installed, suite.LayoutValid, suite.InstallPath, suite.Version, suite.Status,
                suite.BrokerAvailable, suite.Running, suite.Ready, suite.ServiceStatus, suite.Port,
                latestVersion = Descriptor("mediaPlayerSuite")?.Version,
                needsFullSetup = RequiresFullSuiteSetup(suite)
            },
            catalog = new { available = catalog is not null, error = feeds?.CatalogError },
            componentOperation = ReadComponentOperation()
        };
    }

    // Downloads the latest signed extension release into the default (or chosen)
    // folder and registers it. An existing MovieList folder is replaced through
    // the same single recovery directory used by updates.
    internal static string InstallExtensionRelease(SignedDocument document, string targetFolder, Action<string> progress)
    {
        var metadata = ValidateSignedExtensionMetadata(document);
        targetFolder = Path.GetFullPath(targetFolder);
        using var operationMutex = new Mutex(false, UserApplyMutexName);
        if (!TryAcquireOperationMutex(operationMutex))
            throw new InvalidOperationException("Сейчас уже выполняется обновление. Повторите после его завершения.");
        try
        {
            var existing = ReadJson<OperationState>(StatePath);
            if (existing is not null && existing.Status is "queued" or "downloading" or "replacing")
                throw new InvalidOperationException("Нельзя устанавливать расширение во время активного обновления.");
            if (Directory.Exists(targetFolder) && Directory.EnumerateFileSystemEntries(targetFolder).Any())
            {
                var manifest = Path.Combine(targetFolder, "manifest.json");
                if (!File.Exists(manifest) || !IsSameExtension(manifest, metadata.ExtensionId))
                    throw new InvalidOperationException("Папка не пуста и не содержит MovieList. Выберите пустую папку.");
            }

            var parent = Directory.GetParent(targetFolder)?.FullName
                ?? throw new InvalidDataException("The extension folder has no parent directory.");
            Directory.CreateDirectory(parent);
            var operationId = Guid.NewGuid().ToString("D");
            var stageRoot = GetStagingPath(targetFolder, operationId);
            var recoveryPath = GetRecoveryPath(targetFolder, operationId);
            Directory.CreateDirectory(stageRoot);
            try
            {
                progress("downloading");
                var archivePath = Path.Combine(stageRoot, metadata.AssetName);
                DownloadFile(metadata.AssetUrls, archivePath, metadata.Sha256, metadata.Size);
                progress("verifying");
                ValidateArchive(archivePath);
                var extractionPath = Path.Combine(stageRoot, "extension");
                ZipFile.ExtractToDirectory(archivePath, extractionPath, overwriteFiles: false);
                var manifestPath = Path.Combine(extractionPath, "manifest.json");
                if (!File.Exists(manifestPath)) throw new InvalidDataException("The archive does not contain manifest.json at its root.");
                ValidateManifest(manifestPath, metadata);

                progress("installing");
                var replaced = Directory.Exists(targetFolder);
                if (replaced) MoveWithRetry(targetFolder, recoveryPath);
                try
                {
                    MoveWithRetry(extractionPath, targetFolder);
                }
                catch
                {
                    if (replaced && !Directory.Exists(targetFolder) && Directory.Exists(recoveryPath))
                        MoveWithRetry(recoveryPath, targetFolder);
                    throw;
                }
            }
            finally
            {
                TryDeleteDirectory(stageRoot);
                TryDeleteDirectory(recoveryPath);
            }
        }
        finally
        {
            operationMutex.ReleaseMutex();
        }
        return ConnectExtensionFolder(targetFolder);
    }

    private static bool IsSameExtension(string manifestPath, string extensionId)
    {
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
            var key = document.RootElement.GetProperty("key").GetString();
            return !string.IsNullOrWhiteSpace(key) && ComputeExtensionId(key) == extensionId;
        }
        catch (Exception error) when (error is IOException or JsonException or KeyNotFoundException or FormatException or InvalidOperationException)
        {
            return false;
        }
    }

    internal static string ConnectExtensionFolder(string folder)
    {
        using var operationMutex = new Mutex(false, UserApplyMutexName);
        if (!TryAcquireOperationMutex(operationMutex))
            throw new InvalidOperationException("Сейчас уже выполняется обновление. Повторите после его завершения.");
        try
        {
            return RegisterExtensionFolder(folder);
        }
        finally
        {
            operationMutex.ReleaseMutex();
        }
    }

    // Starts the same journaled component worker that the extension uses. The
    // signed catalog is re-validated by the worker before anything runs.
    internal static object StartHubComponent(HubFeeds feeds, string componentId, bool install)
    {
        if (feeds.Catalog is null) return ErrorResponse("CATALOG_NOT_PUBLISHED", "The component catalog is unavailable.");
        // Installing the permanent hub first keeps the worker copy and the
        // Native Messaging registration on one stable executable.
        if (!string.Equals(Path.GetFullPath(Environment.ProcessPath ?? ""), Path.GetFullPath(PermanentUpdater), StringComparison.OrdinalIgnoreCase)
            && LoadConfig() is not null)
        {
            using var mutex = new Mutex(false, UserApplyMutexName);
            if (TryAcquireOperationMutex(mutex))
            {
                try { InstallPermanentHub(Environment.ProcessPath!); }
                finally { mutex.ReleaseMutex(); }
            }
        }
        return StartComponentApplyCore(componentId, Guid.NewGuid().ToString("D"), feeds.Catalog.Text, feeds.Catalog.Signature, install);
    }
}
