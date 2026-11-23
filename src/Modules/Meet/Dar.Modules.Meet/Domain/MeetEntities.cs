namespace Dar.Modules.Meet.Domain;

/// <summary>Google Calendar OAuth account. The refresh token is stored encrypted.</summary>
public sealed class MeetAccount
{
    public Guid Id { get; init; }
    public string Provider { get; init; } = "google";
    public string AccountEmail { get; init; } = "";
    public string CalendarId { get; init; } = "primary";
    public string EncryptedRefreshToken { get; init; } = "";
    public string? TokenScope { get; init; }
    public string? SyncToken { get; init; }
    public DateTimeOffset? LastSyncAt { get; init; }
    public DateTimeOffset? LastFullSyncAt { get; init; }
    public string? LastErrorCode { get; init; }
    public string? LastErrorMessage { get; init; }
    public int ConsecutiveFailures { get; init; }
    public string Status { get; init; } = "connected";
}

/// <summary>Calendar occurrence as stored in meet_events (one row per occurrence).</summary>
public sealed class MeetEventRow
{
    public Guid Id { get; init; }
    public string GoogleEventId { get; init; } = "";
    public string? Summary { get; init; }
    public string? MeetLink { get; init; }
    public string? HtmlLink { get; init; }
    public DateTimeOffset OccurrenceStart { get; init; }
    public DateTimeOffset OccurrenceEnd { get; init; }
    public string? TimeZone { get; init; }
    public string GoogleStatus { get; init; } = "confirmed";
    public bool IsRecurring { get; init; }
    public string RecordingMode { get; init; } = "inherit";
    public Guid? LinkedCircleId { get; init; }
    public string? LinkedCircleName { get; init; }
    public bool LinkedAutomatically { get; init; }
    public bool CircleAutoRecord { get; init; }
    /// <summary>open/trusted override for this occurrence; null inherits the module default.</summary>
    public string? AccessType { get; init; }
}

public sealed class MeetCircleRow
{
    public Guid CircleId { get; init; }
    public string Name { get; init; } = "";
    public bool IsActive { get; init; }
    public bool AutoRecord { get; init; }
    public bool AutoLink { get; init; }
    public int UpcomingLinkedEvents { get; init; }
}

public sealed class MeetSettingsRow
{
    public bool RecordingEnabled { get; init; } = true;
    public int JoinLeadSeconds { get; init; } = 60;
    public int StopGraceSeconds { get; init; } = 120;
    public int MaxConcurrentSessions { get; init; } = 1;
    public int DiskBlockGb { get; init; } = 25;
    public int DiskWarnGb { get; init; } = 40;
    public string UploadBwLimit { get; init; } = "8M";
    public int HlsRetentionHours { get; init; } = 24;
    /// <summary>Access applied when the bot hosts the meeting: open or trusted.</summary>
    public string DefaultAccessType { get; init; } = "open";
    /// <summary>Hard cap for one recording, independent of the calendar end.</summary>
    public int MaxSessionMinutes { get; init; } = 240;
}
