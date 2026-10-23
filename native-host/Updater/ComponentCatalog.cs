using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

// This validator has no IO or platform dependencies. The key parameter is a test
// seam; production callers always supply the embedded release verification key.
public sealed record ComponentDescriptor(string Version, string AssetName, string AssetUrl,
    string Sha256, long Size, string? MinUpdaterVersion, int? ApiMajor, string? BuildId);

public sealed record SignedComponentCatalog(DateTimeOffset PublishedAt,
    IReadOnlyDictionary<string, ComponentDescriptor> Components);

public static class ComponentCatalogValidator
{
    public const long MaxAssetBytes = 1024L * 1024 * 1024;
    public const string RepositoryPrefix = "https://github.com/F1x-hub/MovieListExtension/releases/download/";

    public static SignedComponentCatalog Validate(string text, string signature, string publicKey)
    {
        if (string.IsNullOrWhiteSpace(text) || Encoding.UTF8.GetByteCount(text) > 128 * 1024
            || string.IsNullOrWhiteSpace(signature) || signature.Length > 4096)
            throw new InvalidDataException("Component catalog envelope is invalid.");
        try
        {
            using var rsa = RSA.Create();
            rsa.ImportFromPem(publicKey);
            if (!rsa.VerifyData(Encoding.UTF8.GetBytes(text), Convert.FromBase64String(signature.Trim()),
                    HashAlgorithmName.SHA256, RSASignaturePadding.Pss))
                throw new InvalidDataException("Component catalog signature is invalid.");
        }
        catch (Exception error) when (error is FormatException or CryptographicException or ArgumentException)
        {
            throw new InvalidDataException("Component catalog signature is invalid.", error);
        }
        using var document = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 8 });
        var root = document.RootElement;
        RejectDuplicateProperties(root);
        if (root.ValueKind != JsonValueKind.Object
            || root.GetProperty("schemaVersion").GetInt32() != 1
            || root.GetProperty("productId").GetString() != "movielist"
            || root.GetProperty("channel").GetString() != "stable"
            || !DateTimeOffset.TryParse(root.GetProperty("publishedAt").GetString(), out var publishedAt))
            throw new InvalidDataException("Component catalog identity is invalid.");
        var components = root.GetProperty("components");
        if (components.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Components must be an object.");
        var result = new Dictionary<string, ComponentDescriptor>(StringComparer.Ordinal);
        foreach (var entry in components.EnumerateObject())
        {
            if (entry.Name is not ("extension" or "updater" or "mediaPlayerSuite"))
                throw new InvalidDataException("Unknown component identity.");
            var item = entry.Value;
            var version = item.GetProperty("version").GetString() ?? "";
            var assetName = item.GetProperty("assetName").GetString() ?? "";
            var assetUrl = item.GetProperty("assetUrl").GetString() ?? "";
            var hash = item.GetProperty("sha256").GetString() ?? "";
            var size = item.GetProperty("size").GetInt64();
            var minimum = item.TryGetProperty("minUpdaterVersion", out var min) ? min.GetString() : null;
            var api = item.TryGetProperty("apiMajor", out var apiValue) ? apiValue.GetInt32() : (int?)null;
            var build = item.TryGetProperty("buildId", out var buildValue) ? buildValue.GetString() : null;
            var expectedName = entry.Name switch {
                "extension" => $"MovieList-extension-{version}.zip",
                "updater" => "MovieListSetup.exe", _ => "MediaPlayerSuiteSetup.exe" };
            var suffix = assetUrl.StartsWith(RepositoryPrefix, StringComparison.Ordinal)
                ? assetUrl[RepositoryPrefix.Length..] : "";
            var slash = suffix.IndexOf('/');
            if (!IsStableVersion(version) || assetName != expectedName
                || slash < 2 || !suffix.StartsWith('v') || !IsStableVersion(suffix[1..slash])
                || suffix[(slash + 1)..] != expectedName
                || !Uri.TryCreate(assetUrl, UriKind.Absolute, out var uri) || uri.Scheme != "https"
                || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0
                || !Regex.IsMatch(hash, "\\A[0-9a-fA-F]{64}\\z") || size <= 0 || size > MaxAssetBytes
                || (minimum is not null && !IsStableVersion(minimum))
                || (api is not null && (entry.Name != "mediaPlayerSuite" || api < 1 || api > 100))
                || (build is not null && (entry.Name != "mediaPlayerSuite" || !Regex.IsMatch(build, "\\A[A-Za-z0-9._-]{1,128}\\z"))))
                throw new InvalidDataException($"Invalid descriptor for {entry.Name}.");
            result.Add(entry.Name, new(version, assetName, assetUrl, hash, size, minimum, api, build));
        }
        if (result.Count == 0) throw new InvalidDataException("Component catalog is empty.");
        return new(publishedAt, result);
    }

    public static bool IsStableVersion(string value) => Regex.IsMatch(value, "\\A(?:0|[1-9][0-9]*)(?:\\.(?:0|[1-9][0-9]*)){2,3}\\z")
        && Version.TryParse(value, out _);

    public static int CompareVersions(string left, string right)
    {
        if (!IsStableVersion(left) || !IsStableVersion(right)) throw new InvalidDataException("Invalid stable version.");
        var a = left.Split('.').Select(int.Parse).Concat(new[] { 0 }).Take(4).ToArray();
        var b = right.Split('.').Select(int.Parse).Concat(new[] { 0 }).Take(4).ToArray();
        for (var i = 0; i < 4; i++) if (a[i] != b[i]) return a[i].CompareTo(b[i]);
        return 0;
    }

    private static void RejectDuplicateProperties(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!seen.Add(property.Name)) throw new InvalidDataException("Duplicate catalog property.");
                RejectDuplicateProperties(property.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var child in element.EnumerateArray()) RejectDuplicateProperties(child);
    }
}
