using System.Net.Http;
using System.Net.Http.Json;
using System.Windows;

namespace DarEltahfeez.Desktop;

public partial class ConnectionSettingsWindow : Window
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(5) };
    public string? SavedServerUrl { get; private set; }

    public ConnectionSettingsWindow(string initialUrl)
    {
        InitializeComponent();
        ServerUrlTextBox.Text = initialUrl;
    }

    private async void TestConnection_Click(object sender, RoutedEventArgs e)
    {
        TestButton.IsEnabled = false;
        SaveButton.IsEnabled = false;
        StatusText.Foreground = System.Windows.Media.Brushes.SlateGray;
        StatusText.Text = "جاري اختبار الاتصال...";
        try
        {
            var uri = DesktopSettingsStore.NormalizeServerUri(ServerUrlTextBox.Text);
            using var response = await _http.GetAsync(new Uri(uri, "/health"));
            response.EnsureSuccessStatusCode();
            var health = await response.Content.ReadFromJsonAsync<HealthResponse>();
            if (health is null || health.Status != "ok" || health.Database != "connected" || health.Service != "DarEltahfeez.Api")
                throw new InvalidOperationException("الخادم استجاب، لكن قاعدة البيانات غير متصلة أو العنوان لا يشير إلى خدمة الدار.");
            ServerUrlTextBox.Text = uri.AbsoluteUri.TrimEnd('/');
            StatusText.Foreground = System.Windows.Media.Brushes.SeaGreen;
            StatusText.Text = "الاتصال ناجح وقاعدة البيانات متصلة.";
        }
        catch (Exception ex)
        {
            StatusText.Foreground = System.Windows.Media.Brushes.Firebrick;
            StatusText.Text = ex.Message;
        }
        finally
        {
            TestButton.IsEnabled = true;
            SaveButton.IsEnabled = true;
        }
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            SavedServerUrl = DesktopSettingsStore.NormalizeServerUri(ServerUrlTextBox.Text).AbsoluteUri.TrimEnd('/');
            DialogResult = true;
        }
        catch (Exception ex)
        {
            StatusText.Foreground = System.Windows.Media.Brushes.Firebrick;
            StatusText.Text = ex.Message;
        }
    }

    private sealed record HealthResponse(string Status, string Service, string Database, string? Stage);
}
