namespace Dar.Modules.Meet.Domain;

/// <summary>
/// Recording state machine constants shared by the scheduler, the bot contract and
/// the UI. Transitions are validated server-side; the database CHECK is the last line.
/// </summary>
public static class MeetJobStates
{
    public const string Scheduled = "scheduled";
    public const string Waiting = "waiting";
    public const string Joining = "joining";
    public const string Live = "live";
    public const string Finalizing = "finalizing";
    public const string Uploading = "uploading";
    public const string Ready = "ready";
    public const string Failed = "failed";
    public const string Cancelled = "cancelled";
    public const string Stalled = "stalled";
    public const string Partial = "partial";

    private static readonly IReadOnlyDictionary<string, string[]> Allowed = new Dictionary<string, string[]>(StringComparer.Ordinal)
    {
        [Scheduled] = [Waiting, Joining, Cancelled, Failed],
        [Waiting] = [Joining, Cancelled, Failed, Stalled],
        [Joining] = [Live, Failed, Cancelled, Stalled],
        [Live] = [Finalizing, Failed, Partial, Stalled],
        [Finalizing] = [Uploading, Ready, Failed, Partial],
        [Uploading] = [Ready, Failed],
        [Partial] = [Uploading, Failed, Ready],
        [Stalled] = [Joining, Failed, Cancelled],
        [Ready] = [],
        [Failed] = [Waiting],
        [Cancelled] = []
    };

    public static bool IsKnown(string? state) => state is not null && Allowed.ContainsKey(state);

    public static bool CanTransition(string? from, string to) =>
        from is not null && Allowed.TryGetValue(from, out var next) &&
        next.Contains(to, StringComparer.Ordinal);

    public static bool IsTerminal(string? state) =>
        state is Ready or Failed or Cancelled;
}

/// <summary>Recording scope and calendar event mode rules (unit tested, no IO).</summary>
public static class MeetRecordingPolicy
{
    public const string Inherit = "inherit";
    public const string Force = "force";
    public const string Exclude = "exclude";

    public static bool IsKnownMode(string? mode) =>
        mode is Inherit or Force or Exclude;

    /// <summary>
    /// An occurrence is recorded only when the owner forced it, or when it is linked
    /// to a circle the owner selected for automatic recording — and never when the
    /// occurrence is cancelled or explicitly excluded.
    /// </summary>
    public static bool IsEligible(string? recordingMode, bool linked, bool circleAutoRecord, string? googleStatus)
    {
        if (string.Equals(googleStatus, "cancelled", StringComparison.OrdinalIgnoreCase)) return false;
        if (string.Equals(recordingMode, Exclude, StringComparison.OrdinalIgnoreCase)) return false;
        if (string.Equals(recordingMode, Force, StringComparison.OrdinalIgnoreCase)) return true;
        return linked && circleAutoRecord;
    }
}
