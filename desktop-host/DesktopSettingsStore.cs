using System.IO;
using System.Text.Json;

namespace DarEltahfeez.Desktop;

internal sealed class DesktopSettingsStore
{
    private readonly string _settingsFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "DarEltahfeez", "DesktopSettings.json");

    public string? Load()
    {
        try
        {
            if (!File.Exists(_settingsFile)) return null;
            var settings = JsonSerializer.Deserialize<Settings>(File.ReadAllText(_settingsFile));
            return settings?.ServerUrl is null ? null : NormalizeServerUri(settings.ServerUrl).AbsoluteUri.TrimEnd('/');
        }
        catch { return null; }
    }

    public void Save(string serverUrl)
    {
        var normalized = NormalizeServerUri(serverUrl);
        Directory.CreateDirectory(Path.GetDirectoryName(_settingsFile)!);
        var json = JsonSerializer.Serialize(new Settings(normalized.AbsoluteUri.TrimEnd('/')),
            new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(_settingsFile, json);
    }

    public static Uri NormalizeServerUri(string value)
    {
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw new InvalidOperationException("اكتب عنوان خادم صحيحًا يبدأ بـ http:// أو https://.");

        if (!string.IsNullOrEmpty(uri.UserInfo) || uri.Query.Length > 0 || uri.Fragment.Length > 0 ||
            (uri.AbsolutePath != "/" && uri.AbsolutePath.Length > 0))
            throw new InvalidOperationException("اكتب عنوان الخادم فقط، من غير مسار إضافي أو بيانات دخول.");

        var host = uri.Host.ToLowerInvariant();
        var loopback = host is "localhost" or "127.0.0.1" or "::1";
        var privateLan = host.StartsWith("10.", StringComparison.Ordinal) ||
                         host.StartsWith("192.168.", StringComparison.Ordinal) ||
                         (host.StartsWith("172.", StringComparison.Ordinal) &&
                          int.TryParse(host.Split('.')[1], out var second) && second is >= 16 and <= 31);
        if (uri.Scheme == Uri.UriSchemeHttp && !loopback && !privateLan)
            throw new InvalidOperationException("الاتصال عبر الإنترنت يجب أن يستخدم HTTPS. HTTP مسموح للاختبار المحلي أو الشبكة الداخلية فقط.");

        return new Uri(uri.GetLeftPart(UriPartial.Authority));
    }

    private sealed record Settings(string ServerUrl);
}
