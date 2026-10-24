using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

internal static partial class Program
{
    // The hub UI is bundled HTML served from embedded resources on a private
    // origin. It talks to this window only through WebView2 web messages; no
    // page can pass a path or command that the host does not validate itself.
    private sealed class HubWindow : Form
    {
        private const string Origin = "https://hub.movielist.local/";
        private readonly WebView2 view = new() { Dock = DockStyle.Fill };
        private HubFeeds? feeds;
        private int busy;

        public static bool IsRuntimeAvailable()
        {
            try { return !string.IsNullOrWhiteSpace(CoreWebView2Environment.GetAvailableBrowserVersionString()); }
            catch (Exception error) when (error is WebView2RuntimeNotFoundException or COMException or DllNotFoundException) { return false; }
        }

        public HubWindow()
        {
            Text = "MovieList Hub";
            Width = 1040;
            Height = 760;
            MinimumSize = new Size(760, 560);
            StartPosition = FormStartPosition.CenterScreen;
            var light = IsLightTheme();
            BackColor = light ? Color.FromArgb(0xf4, 0xf4, 0xf5) : Color.FromArgb(0x09, 0x09, 0x0b);
            view.DefaultBackgroundColor = BackColor;
            using (var icon = ReadResource(light ? "hub/icon-black.png" : "hub/icon-white.png"))
            {
                if (icon is not null) Icon = Icon.FromHandle(new Bitmap(icon).GetHicon());
            }
            Controls.Add(view);
            HandleCreated += (_, _) => ApplyTitleBarTheme(light);
            Load += async (_, _) =>
            {
                await Task.Run(UpgradeConnectedHub);
                await InitializeViewAsync();
            };
        }

        // Running a newer downloaded hub is how an existing user upgrades it:
        // the permanent copy that Chrome starts is replaced once, then the
        // downloaded file is no longer needed.
        private static void UpgradeConnectedHub()
        {
            if (LoadConfig() is null || Environment.ProcessPath is not { } running) return;
            using var mutex = new Mutex(false, UserApplyMutexName);
            if (!TryAcquireOperationMutex(mutex)) return;
            try { InstallPermanentHub(running); }
            catch (Exception error) when (error is IOException or InvalidOperationException or InvalidDataException
                or UnauthorizedAccessException or ComponentFailure) { }
            finally { mutex.ReleaseMutex(); }
        }

        private async Task InitializeViewAsync()
        {
            try
            {
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(DataRoot, "webview"));
                await view.EnsureCoreWebView2Async(environment);
            }
            catch (Exception error) when (error is WebView2RuntimeNotFoundException or COMException or IOException or UnauthorizedAccessException)
            {
                MessageBox.Show(this, "Не удалось запустить окно MovieList Hub: " + error.Message, "MovieList Hub", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
                return;
            }
            var core = view.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.AreDevToolsEnabled = Debugger.IsAttached;
            core.AddWebResourceRequestedFilter(Origin + "*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += ServeResource;
            core.NavigationStarting += (_, args) =>
            {
                if (!args.Uri.StartsWith(Origin, StringComparison.Ordinal)) args.Cancel = true;
            };
            core.NewWindowRequested += (_, args) => args.Handled = true;
            core.WebMessageReceived += (_, args) => HandleMessage(args.WebMessageAsJson);
            core.Navigate(Origin + "index.html");
        }

        private void ServeResource(object? sender, CoreWebView2WebResourceRequestedEventArgs args)
        {
            var path = new Uri(args.Request.Uri).AbsolutePath.TrimStart('/');
            var stream = ReadResource("hub/" + path);
            if (stream is null)
            {
                args.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(null, 404, "Not Found", "");
                return;
            }
            var type = Path.GetExtension(path) switch
            {
                ".html" => "text/html; charset=utf-8",
                ".css" => "text/css; charset=utf-8",
                ".js" => "text/javascript; charset=utf-8",
                ".png" => "image/png",
                _ => "application/octet-stream"
            };
            const string policy = "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'";
            args.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(stream, 200, "OK",
                $"Content-Type: {type}\r\nContent-Security-Policy: {policy}\r\nCache-Control: no-store");
        }

        private static Stream? ReadResource(string name) =>
            typeof(Program).Assembly.GetManifestResourceStream(name);

        private void HandleMessage(string json)
        {
            string? id = null, action = null;
            JsonElement args = default;
            try
            {
                using var document = JsonDocument.Parse(json);
                id = document.RootElement.GetProperty("id").GetString();
                action = document.RootElement.GetProperty("action").GetString();
                args = document.RootElement.TryGetProperty("args", out var value) ? value.Clone() : default;
            }
            catch (Exception error) when (error is JsonException or KeyNotFoundException or InvalidOperationException)
            {
                return;
            }

            // Dialogs and the clipboard need the UI thread; everything else runs
            // in the background so downloads never freeze the window.
            switch (action)
            {
                case "chooseFolder":
                    Reply(id, ChooseFolder(args));
                    return;
                case "copyText":
                    Reply(id, CopyText(args));
                    return;
            }
            _ = Task.Run(() =>
            {
                object result;
                try { result = RunAction(action, args); }
                catch (Exception error) when (error is not OutOfMemoryException)
                {
                    result = ErrorResponse(error is ComponentFailure failure ? failure.Code : "HUB_ACTION_FAILED", error.Message);
                }
                Reply(id, result);
            });
        }

        private object RunAction(string? action, JsonElement args)
        {
            switch (action)
            {
                case "status":
                    if (feeds is null || ReadBoolean(args, "refresh")) feeds = FetchHubFeeds();
                    return HubStatus(feeds);
                case "installExtension":
                    return Exclusive(() =>
                    {
                        feeds ??= FetchHubFeeds();
                        if (feeds.Extension is null) return ErrorResponse(feeds.ExtensionError ?? "FEED_UNAVAILABLE", "Release metadata is unavailable.");
                        var folder = ReadString(args, "folder");
                        var target = string.IsNullOrWhiteSpace(folder) ? DefaultExtensionFolder : folder!;
                        var extensionId = InstallExtensionRelease(feeds.Extension, target, step => Notify("progress", step));
                        return new { success = true, path = Path.GetFullPath(target), extensionId };
                    });
                case "connectFolder":
                    return Exclusive(() =>
                    {
                        var folder = ReadString(args, "folder") ?? throw new InvalidDataException("Папка не выбрана.");
                        var extensionId = ConnectExtensionFolder(folder);
                        return new { success = true, path = Path.GetFullPath(folder), extensionId };
                    });
                case "openExtensionsPage":
                    return OpenChromeExtensionsPage()
                        ? new { success = true }
                        : ErrorResponse("CHROME_NOT_FOUND", "Chrome was not found.");
                case "openFolder":
                    return OpenKnownFolder(ReadString(args, "target"));
                case "installPlayer":
                case "updatePlayer":
                case "updateHub":
                    return Exclusive(() =>
                    {
                        feeds ??= FetchHubFeeds();
                        var component = action == "updateHub" ? "updater" : "mediaPlayerSuite";
                        return StartHubComponent(feeds, component, install: action == "installPlayer");
                    });
                case "dismissComponent":
                    return DismissComponentOperationCore(ReadString(args, "operationId"));
                default:
                    return ErrorResponse("ACTION_UNSUPPORTED", "Unsupported hub action.");
            }
        }

        // One long-running hub action at a time; repeated clicks get a clear answer.
        private object Exclusive(Func<object> work)
        {
            if (Interlocked.Exchange(ref busy, 1) == 1) return ErrorResponse("HUB_BUSY", "Another hub action is running.");
            try { return work(); }
            finally { Volatile.Write(ref busy, 0); }
        }

        private object OpenKnownFolder(string? target)
        {
            var path = target switch
            {
                "extension" => LoadConfig()?.ExtensionPath,
                "player" => ReadSuiteInventory().InstallPath,
                _ => null
            };
            if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path))
                return ErrorResponse("FOLDER_UNAVAILABLE", "The folder does not exist.");
            Process.Start(new ProcessStartInfo("explorer.exe") { UseShellExecute = false, ArgumentList = { path } })?.Dispose();
            return new { success = true };
        }

        private object ChooseFolder(JsonElement args)
        {
            using var dialog = new FolderBrowserDialog
            {
                Description = ReadString(args, "title") ?? "Выберите папку",
                UseDescriptionForTitle = true,
                ShowNewFolderButton = true,
                InitialDirectory = ReadString(args, "initial") ?? ""
            };
            return dialog.ShowDialog(this) == DialogResult.OK
                ? new { success = true, path = dialog.SelectedPath }
                : new { success = false, errorCode = "CANCELLED" };
        }

        private static object CopyText(JsonElement args)
        {
            var text = ReadString(args, "text");
            if (string.IsNullOrEmpty(text) || text.Length > 2048) return ErrorResponse("COPY_INVALID", "Nothing to copy.");
            try { Clipboard.SetText(text); return new { success = true }; }
            catch (ExternalException) { return ErrorResponse("CLIPBOARD_BUSY", "The clipboard is busy."); }
        }

        private void Notify(string name, string value) =>
            Post(JsonSerializer.Serialize(new { @event = name, value }, JsonOptions));

        private void Reply(string? id, object result) =>
            Post(JsonSerializer.Serialize(new { id, result }, JsonOptions));

        private void Post(string json)
        {
            if (IsDisposed) return;
            try
            {
                if (InvokeRequired) BeginInvoke(() => view.CoreWebView2?.PostWebMessageAsJson(json));
                else view.CoreWebView2?.PostWebMessageAsJson(json);
            }
            catch (Exception error) when (error is ObjectDisposedException or InvalidOperationException) { }
        }

        private static string? ReadString(JsonElement args, string name) =>
            args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString() : null;

        private static bool ReadBoolean(JsonElement args, string name) =>
            args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.True;

        private static bool IsLightTheme()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
                return key?.GetValue("AppsUseLightTheme") is int value && value != 0;
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.SecurityException) { return false; }
        }

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);

        private void ApplyTitleBarTheme(bool light)
        {
            var dark = light ? 0 : 1;
            try { _ = DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int)); }
            catch (Exception error) when (error is DllNotFoundException or EntryPointNotFoundException) { }
        }
    }
}
