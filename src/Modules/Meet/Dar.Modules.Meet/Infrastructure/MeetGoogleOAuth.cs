using System.Net;
using System.Text.Json;
using Dar.Common.Domain;

namespace Dar.Modules.Meet.Infrastructure;

public sealed record GoogleTokenResult(string AccessToken, string? RefreshToken, string? Scope, DateTimeOffset ExpiresAt);

/// <summary>Outcome of exchanging the stored refresh token for an access token.</summary>
public sealed record GoogleRefreshOutcome(GoogleTokenResult? Token, string? ErrorCode, bool NeedsReconnect, string? Message);

/// <summary>
/// Minimal OAuth 2.0 client for Google Calendar. The official Google.Apis.Calendar.v3
/// package is not part of this installation's offline feed (ADR-0007), and the three
/// calls we need are small enough to keep dependency-free and unit testable.
/// </summary>
public sealed class MeetGoogleOAuth
{
    private readonly HttpClient _http;
    private readonly IOptions<MeetOptions> _options;

    public MeetGoogleOAuth(IOptions<MeetOptions> options)
        : this(options, new HttpClient { Timeout = TimeSpan.FromSeconds(30) }) { }

    public MeetGoogleOAuth(IOptions<MeetOptions> options, HttpClient http)
    {
        _options = options;
        _http = http;
    }

    private MeetOptions Options => _options.Value;

    public string BuildAuthorizationUrl(string state)
    {
        var query = new Dictionary<string, string>
        {
            ["client_id"] = Options.Google.ClientId,
            ["redirect_uri"] = Options.Google.RedirectUri,
            ["response_type"] = "code",
            ["scope"] = string.Join(' ', Options.Google.Scopes),
            ["access_type"] = "offline",
            ["include_granted_scopes"] = "true",
            ["prompt"] = "consent",
            ["state"] = state
        };
        var encoded = string.Join('&', query.Select(pair =>
            $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}"));
        return "https://accounts.google.com/o/oauth2/v2/auth?" + encoded;
    }

    public async Task<GoogleTokenResult> ExchangeCodeAsync(string code, CancellationToken ct)
    {
        var (document, status) = await PostTokenAsync(new Dictionary<string, string>
        {
            ["code"] = code,
            ["client_id"] = Options.Google.ClientId,
            ["client_secret"] = Options.Google.ClientSecret,
            ["redirect_uri"] = Options.Google.RedirectUri,
            ["grant_type"] = "authorization_code"
        }, ct);

        using (document)
        {
            if (document is null || status != HttpStatusCode.OK)
                throw new AppException("تعذّر إكمال ربط تقويم Google. أعد المحاولة.", 502);

            var root = document.RootElement;
            var accessToken = ReadString(root, "access_token");
            var refreshToken = ReadString(root, "refresh_token");
            if (string.IsNullOrWhiteSpace(accessToken) || string.IsNullOrWhiteSpace(refreshToken))
                throw new AppException(
                    "لم يُرجع Google تصريحًا دائمًا. أعد الربط ووافق على الوصول للتقويم.", 502);

            return new GoogleTokenResult(
                accessToken,
                refreshToken,
                ReadString(root, "scope"),
                DateTimeOffset.UtcNow.AddSeconds(ReadInt(root, "expires_in") ?? 3600));
        }
    }

    public async Task<GoogleRefreshOutcome> RefreshAsync(string refreshToken, CancellationToken ct)
    {
        var (document, status) = await PostTokenAsync(new Dictionary<string, string>
        {
            ["refresh_token"] = refreshToken,
            ["client_id"] = Options.Google.ClientId,
            ["client_secret"] = Options.Google.ClientSecret,
            ["grant_type"] = "refresh_token"
        }, ct);

        using (document)
        {
            if (document is not null && status == HttpStatusCode.OK)
            {
                var root = document.RootElement;
                var accessToken = ReadString(root, "access_token");
                if (string.IsNullOrWhiteSpace(accessToken))
                    return new GoogleRefreshOutcome(null, "invalid_response", true, "استجابة Google لا تحتوي على تصريح وصول.");

                return new GoogleRefreshOutcome(
                    new GoogleTokenResult(accessToken, null, ReadString(root, "scope"),
                        DateTimeOffset.UtcNow.AddSeconds(ReadInt(root, "expires_in") ?? 3600)),
                    null,
                    false,
                    null);
            }

            var errorCode = "http_" + (int)status;
            if (document is not null && document.RootElement.TryGetProperty("error", out var error))
                errorCode = error.ValueKind == JsonValueKind.String ? error.GetString() ?? errorCode : errorCode;

            var reconnect = errorCode is "invalid_grant" or "unauthorized_client" or "http_401" or "http_400";
            return new GoogleRefreshOutcome(
                null,
                errorCode,
                reconnect,
                reconnect
                    ? "انتهت صلاحية ربط تقويم Google. يلزم إعادة الربط من صفحة التسجيل."
                    : "تعذّر تجديد تصريح Google مؤقتًا. ستُعاد المحاولة تلقائيًا.");
        }
    }

    /// <summary>FINAL 1.15: best-effort revocation of the Google grant on disconnect.</summary>
    public async Task<bool> RevokeAsync(string? token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token)) return false;
        try
        {
            using var content = new FormUrlEncodedContent(new Dictionary<string, string> { ["token"] = token });
            using var response = await _http.PostAsync("https://oauth2.googleapis.com/revoke", content, ct);
            // Google returns 400 for an already-invalid/expired token; treat it as gone.
            return response.IsSuccessStatusCode || (int)response.StatusCode == 400;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return false;
        }
    }

    public async Task<string?> GetAccountEmailAsync(string accessToken, CancellationToken ct)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "https://www.googleapis.com/oauth2/v3/userinfo");
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
            using var response = await _http.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode) return null;
            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            return ReadString(document.RootElement, "email");
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or JsonException)
        {
            return null;
        }
    }

    private async Task<(JsonDocument? Document, HttpStatusCode Status)> PostTokenAsync(
        IDictionary<string, string> form,
        CancellationToken ct)
    {
        try
        {
            using var content = new FormUrlEncodedContent(form);
            using var response = await _http.PostAsync("https://oauth2.googleapis.com/token", content, ct);
            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            try
            {
                return (await JsonDocument.ParseAsync(stream, cancellationToken: ct), response.StatusCode);
            }
            catch (JsonException)
            {
                return (null, response.StatusCode);
            }
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return (null, HttpStatusCode.ServiceUnavailable);
        }
    }

    private static string? ReadString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static int? ReadInt(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.TryGetInt32(out var parsed) ? parsed : null;
}
