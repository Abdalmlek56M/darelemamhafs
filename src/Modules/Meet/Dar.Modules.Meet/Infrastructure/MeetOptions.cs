namespace Dar.Modules.Meet.Infrastructure;

/// <summary>
/// Configuration for the recording module. Secrets never live in appsettings.json:
/// in production they come from /etc/dar/meet.env (640 root:dar) through Meet__* keys.
/// </summary>
public sealed class MeetOptions
{
    public const string SectionName = "Meet";

    public MeetGoogleOptions Google { get; set; } = new();

    /// <summary>Base64 of a 32-byte AES-GCM key used for the refresh token and OAuth state.</summary>
    public string EncryptionKey { get; set; } = "";

    /// <summary>Shared secret for the loopback-only bot API (Meet__InternalToken).</summary>
    public string InternalToken { get; set; } = "";

    /// <summary>Where the bot keeps HLS segments and final MP4 files.</summary>
    public string MediaRoot { get; set; } = "/var/lib/dar/media/meet";

    /// <summary>A job whose heartbeat is older than this is reported as stale.</summary>
    public int BotHealthStaleSeconds { get; set; } = 90;

    /// <summary>Where the OAuth callback returns the browser (the admin SPA route).</summary>
    public string AdminRedirectPath { get; set; } = "/management";

    public int SyncIntervalSeconds { get; set; } = 60;
    public int FullSyncHours { get; set; } = 6;
    public int SyncWindowDaysBack { get; set; } = 30;
    public int SyncWindowDaysAhead { get; set; } = 60;
    public int StateLifetimeMinutes { get; set; } = 10;

    /// <summary>Minimum matcher confidence (0-100) accepted for an automatic link.</summary>
    public int AutoLinkMinConfidence { get; set; } = 100;

    public IReadOnlyList<string> MissingPrerequisites()
    {
        var missing = new List<string>();
        if (string.IsNullOrWhiteSpace(Google.ClientId)) missing.Add("Meet:Google:ClientId");
        if (string.IsNullOrWhiteSpace(Google.ClientSecret)) missing.Add("Meet:Google:ClientSecret");
        if (string.IsNullOrWhiteSpace(Google.RedirectUri)) missing.Add("Meet:Google:RedirectUri");
        if (!IsValidKey(EncryptionKey)) missing.Add("Meet:EncryptionKey (32 bytes base64)");
        return missing;
    }

    public bool IsConfigured => MissingPrerequisites().Count == 0;

    public static bool IsValidKey(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        try
        {
            return Convert.FromBase64String(value).Length == 32;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}

public sealed class MeetGoogleOptions
{
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";
    public string RedirectUri { get; set; } = "";

    /// <summary>Read-only calendar scope plus the identity scope used to show the account email.</summary>
    public string[] Scopes { get; set; } =
    [
        "https://www.googleapis.com/auth/calendar.events.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
        "openid"
    ];
}
