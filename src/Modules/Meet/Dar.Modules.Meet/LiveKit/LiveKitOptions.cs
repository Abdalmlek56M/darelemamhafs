using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Dar.Modules.Meet.LiveKit;

/// <summary>
/// LiveKit server settings read strictly from LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.
/// Never logs or exposes API keys or secrets.
/// </summary>
public sealed class LiveKitOptions
{
    public const string EnvUrl = "LIVEKIT_URL";
    public const string EnvApiKey = "LIVEKIT_API_KEY";
    public const string EnvApiSecret = "LIVEKIT_API_SECRET";

    public string Url { get; }
    public string ApiKey { get; }
    public string ApiSecret { get; }

    public LiveKitOptions(string? url, string? apiKey, string? apiSecret)
    {
        Url = url?.Trim() ?? string.Empty;
        ApiKey = apiKey?.Trim() ?? string.Empty;
        ApiSecret = apiSecret?.Trim() ?? string.Empty;
    }

    public static LiveKitOptions FromConfiguration(IConfiguration configuration) => new(
        configuration[EnvUrl],
        configuration[EnvApiKey],
        configuration[EnvApiSecret]);

    public IReadOnlyList<string> MissingVariables()
    {
        var missing = new List<string>(3);
        if (string.IsNullOrWhiteSpace(Url)) missing.Add(EnvUrl);
        if (string.IsNullOrWhiteSpace(ApiKey)) missing.Add(EnvApiKey);
        if (string.IsNullOrWhiteSpace(ApiSecret)) missing.Add(EnvApiSecret);
        return missing;
    }

    public bool IsConfigured => MissingVariables().Count == 0;

    public Uri? ResolveHttpBaseUri()
    {
        if (!Uri.TryCreate(Url, UriKind.Absolute, out var parsed)) return null;
        var builder = new UriBuilder(parsed)
        {
            Scheme = parsed.Scheme.Equals("wss", StringComparison.OrdinalIgnoreCase) ? "https"
                : parsed.Scheme.Equals("ws", StringComparison.OrdinalIgnoreCase) ? "http"
                : parsed.Scheme,
            Path = string.Empty,
            Query = string.Empty,
        };
        return builder.Uri;
    }

    public void LogStatus(ILogger logger)
    {
        var missing = MissingVariables();
        if (missing.Count > 0)
        {
            logger.LogWarning(
                "LiveKit meetings disabled: missing required environment variable(s): {MissingVariables}.",
                string.Join(", ", missing));
            return;
        }
        logger.LogInformation("LiveKit meetings enabled.");
    }
}
