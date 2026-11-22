namespace Dar.Modules.Meet;

/// <summary>Request/response contracts for /api/v1/meet. Kept camelCase-safe by naming.</summary>
public sealed record MeetCalendarStatusDto(
    bool ModuleConfigured,
    string[] MissingPrerequisites,
    bool Connected,
    string? AccountEmail,
    string? CalendarId,
    string? Status,
    DateTimeOffset? LastSyncAt,
    DateTimeOffset? LastFullSyncAt,
    string? LastErrorCode,
    string? LastErrorMessage,
    int ConsecutiveFailures);

public sealed record MeetConnectResponse(string AuthorizationUrl);

public sealed record MeetSyncResponse(
    bool Ok,
    bool FullResync,
    int Added,
    int Updated,
    int Cancelled,
    int AutoLinked,
    DateTimeOffset? SyncedAt,
    string? Message);

public sealed record MeetEventDto(
    Guid Id,
    string GoogleEventId,
    string? Summary,
    string? MeetLink,
    string? HtmlLink,
    DateTimeOffset StartsAt,
    DateTimeOffset EndsAt,
    string? TimeZone,
    string GoogleStatus,
    bool IsRecurring,
    string RecordingMode,
    Guid? CircleId,
    string? CircleName,
    bool LinkedAutomatically,
    Guid? SuggestedCircleId,
    string? SuggestedCircleName,
    int SuggestedConfidence,
    bool RecordingEligible);

public sealed record MeetEventPageDto(
    DateTimeOffset From,
    DateTimeOffset To,
    int Page,
    int PageSize,
    int Total,
    IReadOnlyList<MeetEventDto> Items,
    string? NextCursor);

public sealed record MeetLinkEventRequest(Guid CircleId, bool EnableRecording);

public sealed record MeetRecordingModeRequest(string Mode);

public sealed record MeetCircleSettingDto(
    Guid CircleId,
    string Name,
    bool IsActive,
    bool AutoRecord,
    bool AutoLink,
    int UpcomingLinkedEvents);

public sealed record MeetCircleSettingRequest(bool AutoRecord, bool AutoLink);

public sealed record MeetSettingsDto(
    bool RecordingEnabled,
    int JoinLeadSeconds,
    int StopGraceSeconds,
    int MaxConcurrentSessions,
    int DiskBlockGb,
    int DiskWarnGb,
    string UploadBwLimit,
    int HlsRetentionHours);
