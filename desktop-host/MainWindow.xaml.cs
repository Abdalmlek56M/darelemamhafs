using System.Net.Http;
using Microsoft.Web.WebView2.Core;
using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json;
using System.Windows;
using System.Windows.Media;

namespace DarEltahfeez.Desktop;

public partial class MainWindow : Window
{
    private readonly DesktopSettingsStore _settingsStore = new();
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(5) };
    private Uri? _serverUri;
    private bool _webViewInitialized;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += MainWindow_Loaded;
        PreviewKeyDown += MainWindow_PreviewKeyDown;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        var configured = _settingsStore.Load();
        var localTest = Environment.GetEnvironmentVariable("DAR_DESKTOP_LOCAL_CLIENT") == "1";
        var initialUrl = localTest
            ? "http://127.0.0.1:5080"
            : configured ?? Environment.GetEnvironmentVariable("DAR_DESKTOP_URL") ?? "http://127.0.0.1:5080";
        await NavigateToServerAsync(initialUrl);
    }

    private async Task NavigateToServerAsync(string url)
    {
        ShowLoading("جاري التحقق من اتصال الدار...");
        try
        {
            var uri = DesktopSettingsStore.NormalizeServerUri(url);
            await CheckServerAsync(uri);

            if (!_webViewInitialized)
            {
                StatusText.Text = "جاري تجهيز نافذة التطبيق...";
                await Browser.EnsureCoreWebView2Async();
                Browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
                Browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                Browser.CoreWebView2.Settings.IsStatusBarEnabled = false;
                Browser.CoreWebView2.Settings.IsZoomControlEnabled = true;
                Browser.CoreWebView2.NewWindowRequested += Browser_NewWindowRequested;
                Browser.CoreWebView2.NavigationStarting += Browser_NavigationStarting;
                Browser.CoreWebView2.PermissionRequested += Browser_PermissionRequested;
                Browser.CoreWebView2.WebMessageReceived += Browser_WebMessageReceived;
                _webViewInitialized = true;
            }

            _serverUri = uri;
            Browser.Source = uri;
            Browser.Visibility = Visibility.Visible;
            LoadingPanel.Visibility = Visibility.Collapsed;
            ErrorPanel.Visibility = Visibility.Collapsed;
        }
        catch (WebView2RuntimeNotFoundException ex)
        {
            App.WriteDiagnostic("WebView2RuntimeNotFound", ex.ToString());
            ShowError("مكوّن Microsoft Edge WebView2 Runtime غير موجود. ثبّته مرة واحدة على هذا الكمبيوتر ثم أعد فتح التطبيق.");
        }
        catch (Exception ex)
        {
            App.WriteDiagnostic("MainWindow.NavigateToServerAsync", ex.ToString());
            ShowError(ex.Message);
        }
    }

    private async Task CheckServerAsync(Uri uri)
    {
        using var response = await _http.GetAsync(new Uri(uri, "/health"));
        response.EnsureSuccessStatusCode();
        var health = await response.Content.ReadFromJsonAsync<HealthResponse>();
        if (health is null || health.Status != "ok" || health.Database != "connected" || health.Service != "DarEltahfeez.Api")
            throw new InvalidOperationException("الخادم استجاب، لكن اتصال قاعدة البيانات غير سليم أو أن العنوان لا يشير إلى خدمة دار التحفيظ.");
    }

    private void Browser_NewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        // The export/print view is written into an about:blank popup by the React UI.
        // Let WebView2 handle this local blank page, but keep external navigation out of the embedded app.
        if (string.Equals(e.Uri, "about:blank", StringComparison.OrdinalIgnoreCase)) return;

        e.Handled = true;
        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var target) && target.Scheme == Uri.UriSchemeHttps)
        {
            try { Process.Start(new ProcessStartInfo(target.AbsoluteUri) { UseShellExecute = true }); }
            catch { /* The main application remains available if the external browser cannot be opened. */ }
        }
    }

    private void Browser_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        // The credential bridge is intentionally limited to the local desktop UI origin.
        // Never expose Windows-protected credentials to an arbitrary configured/remote page.
        if (!IsTrustedLocalCredentialOrigin(e.Source)) return;
        try
        {
            using var document = JsonDocument.Parse(e.WebMessageAsJson);
            var root = document.RootElement;
            if (!root.TryGetProperty("type", out var typeValue)) return;
            var type = typeValue.GetString();
            var requestId = root.TryGetProperty("requestId", out var requestIdValue) && requestIdValue.ValueKind == JsonValueKind.String
                ? requestIdValue.GetString() : null;

            if (type == "setTheme")
            {
                var requestedTheme = root.TryGetProperty("theme", out var themeValue) && themeValue.ValueKind == JsonValueKind.String
                    ? themeValue.GetString() : "dark";
                ApplyTitleBarTheme(string.Equals(requestedTheme, "light", StringComparison.OrdinalIgnoreCase));
                return;
            }

            if (type == "openConnectionSettings")
            {
                OpenConnectionSettingsFromBridge(requestId);
                return;
            }

            // App preferences are local Windows settings, exposed only to the trusted local WebView origin.
            if (type == "getAutoStartState")
            {
                Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
                {
                    type = "autoStartState",
                    requestId,
                    enabled = AutoStartManager.IsEnabledForCurrentLocation()
                }));
                return;
            }
            if (type == "setAutoStart")
            {
                var enabled = root.TryGetProperty("enabled", out var enabledValue) && enabledValue.ValueKind == JsonValueKind.True;
                try
                {
                    AutoStartManager.SetEnabled(enabled);
                    Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
                    {
                        type = "autoStartResult",
                        requestId,
                        success = true,
                        enabled = AutoStartManager.IsEnabledForCurrentLocation()
                    }));
                }
                catch (Exception ex)
                {
                    Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
                    {
                        type = "autoStartResult",
                        requestId,
                        success = false,
                        enabled = AutoStartManager.IsEnabledForCurrentLocation(),
                        error = ex.Message
                    }));
                }
                return;
            }

            var username = root.TryGetProperty("username", out var usernameValue) ? usernameValue.GetString() : null;
            if (string.IsNullOrWhiteSpace(username)) return;
            var password = root.TryGetProperty("password", out var passwordValue) && passwordValue.ValueKind == JsonValueKind.String
                ? passwordValue.GetString() : null;
            var displayName = root.TryGetProperty("displayName", out var displayValue) && displayValue.ValueKind == JsonValueKind.String
                ? displayValue.GetString() : username;

            switch (type)
            {
                case "saveCredential" when !string.IsNullOrEmpty(password):
                    WindowsCredentialVault.Save(username, password, displayName ?? username);
                    break;
                case "updateCredential" when !string.IsNullOrEmpty(password):
                    WindowsCredentialVault.UpdateIfSaved(username, password, displayName ?? username);
                    break;
                case "deleteCredential":
                    WindowsCredentialVault.Delete(username);
                    break;
                case "getCredential":
                {
                    var credential = WindowsCredentialVault.Get(username);
                    Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
                    {
                        type = "credentialResult",
                        username,
                        password = credential?.Password
                    }));
                    break;
                }
            }
        }
        catch
        {
            // Credential convenience is optional. A vault error must not break ordinary login.
        }
    }


    private void ApplyTitleBarTheme(bool light)
    {
        var colors = light
            ? new Dictionary<string, string>
            {
                ["TitleBarBackground"] = "#F4F7FB",
                ["TitleBarPrimaryForeground"] = "#182437",
                ["TitleBarSecondaryForeground"] = "#6E7D91",
                ["TitleBarDividerBrush"] = "#D7DFEA",
                ["TitleBarActionForeground"] = "#596A80",
                ["TitleBarHoverBackground"] = "#E2E8F0",
                ["TitleBarPressedBackground"] = "#CBD5E1",
                ["TitleBarHoverForeground"] = "#182437",
                ["TitleBarCloseHoverBackground"] = "#C92A3A",
                ["TitleBarClosePressedBackground"] = "#9F1D2B"
            }
            : new Dictionary<string, string>
            {
                ["TitleBarBackground"] = "#080E18",
                ["TitleBarPrimaryForeground"] = "#E9EFF7",
                ["TitleBarSecondaryForeground"] = "#8493A7",
                ["TitleBarDividerBrush"] = "#29364A",
                ["TitleBarActionForeground"] = "#BCC8D8",
                ["TitleBarHoverBackground"] = "#1C293A",
                ["TitleBarPressedBackground"] = "#26364B",
                ["TitleBarHoverForeground"] = "#FFFFFF",
                ["TitleBarCloseHoverBackground"] = "#C92A3A",
                ["TitleBarClosePressedBackground"] = "#9F1D2B"
            };

        foreach (var pair in colors)
        {
            var color = (Color)ColorConverter.ConvertFromString(pair.Value)!;
            Application.Current.Resources[pair.Key] = new SolidColorBrush(color);
        }
    }

    private static bool IsTrustedLocalCredentialOrigin(string source)
    {
        return Uri.TryCreate(source, UriKind.Absolute, out var uri)
            && uri.Scheme == Uri.UriSchemeHttp
            && uri.Port == 5080
            && (string.Equals(uri.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase)
                || string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase));
    }

    private void Browser_PermissionRequested(object? sender, CoreWebView2PermissionRequestedEventArgs e)
    {
        // Only the local app may request the notifications permission; every other permission is denied.
        e.State = e.PermissionKind == CoreWebView2PermissionKind.Notifications && IsTrustedLocalCredentialOrigin(e.Uri)
            ? CoreWebView2PermissionState.Allow
            : CoreWebView2PermissionState.Deny;
    }

    private void Browser_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        // Keep the print/export popup's local blank document navigable inside WebView2.
        if (string.Equals(e.Uri, "about:blank", StringComparison.OrdinalIgnoreCase)) return;

        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var target) || _serverUri is null)
        {
            e.Cancel = true;
            return;
        }

        if (!string.Equals(target.GetLeftPart(UriPartial.Authority), _serverUri.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase))
        {
            e.Cancel = true;
            if (target.Scheme == Uri.UriSchemeHttps)
            {
                try { Process.Start(new ProcessStartInfo(target.AbsoluteUri) { UseShellExecute = true }); }
                catch { /* Ignore external browser launch failures. */ }
            }
        }
    }

    private async void Retry_Click(object sender, RoutedEventArgs e)
    {
        await NavigateToServerAsync(_serverUri?.AbsoluteUri ?? "http://127.0.0.1:5080");
    }

    private async void ConfigureConnection_Click(object sender, RoutedEventArgs e)
    {
        await ConfigureConnectionAsync();
    }

    private void OpenConnectionSettingsFromBridge(string? requestId)
    {
        // Let WebView2 finish dispatching the message before opening a modal WPF dialog.
        Dispatcher.BeginInvoke(new Action(async () => await ConfigureConnectionAsync(requestId)));
    }

    private async Task ConfigureConnectionAsync(string? requestId = null)
    {
        var current = _serverUri?.AbsoluteUri ?? _settingsStore.Load() ?? "http://127.0.0.1:5080";
        var dialog = new ConnectionSettingsWindow(current) { Owner = this };
        if (!string.IsNullOrWhiteSpace(requestId) && Browser.CoreWebView2 is not null)
        {
            Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                type = "connectionSettingsOpened",
                requestId,
                success = true
            }));
        }
        if (dialog.ShowDialog() == true && !string.IsNullOrWhiteSpace(dialog.SavedServerUrl))
        {
            _settingsStore.Save(dialog.SavedServerUrl);
            await NavigateToServerAsync(dialog.SavedServerUrl);
        }
    }

    private void Reload_Click(object sender, RoutedEventArgs e)
    {
        if (Browser.Visibility == Visibility.Visible) Browser.Reload();
        else _ = NavigateToServerAsync(_serverUri?.AbsoluteUri ?? "http://127.0.0.1:5080");
    }

    private void Minimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

    private void Maximize_Click(object sender, RoutedEventArgs e) =>
        WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    private void MainWindow_PreviewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.F5)
        {
            Reload_Click(this, new RoutedEventArgs());
            e.Handled = true;
        }
    }

    private void ShowLoading(string message)
    {
        StatusText.Text = message;
        LoadingPanel.Visibility = Visibility.Visible;
        ErrorPanel.Visibility = Visibility.Collapsed;
        if (_webViewInitialized) Browser.Visibility = Visibility.Collapsed;
    }

    private void ShowError(string message)
    {
        ErrorText.Text = message;
        ErrorPanel.Visibility = Visibility.Visible;
        LoadingPanel.Visibility = Visibility.Collapsed;
        Browser.Visibility = Visibility.Collapsed;
    }

    private sealed record HealthResponse(string Status, string Service, string Database, string? Stage);
}
