using System.Security.Claims;

namespace Dar.Modules.Meet.LiveKit;

public sealed record EffectiveRoomSettings(
    string AccessMode,
    bool WaitingRoomEnabled,
    bool AllowStudentScreenshare,
    bool OnlyHostCanUnmute);

public static class LiveKitRoomPolicy
{
    private static readonly string[] AdminHostPermissions =
    [
        "circles.edit",
        "attendance.edit",
        "users.manage",
        "meet.manage",
    ];

    public static EffectiveRoomSettings ResolveSettings(
        bool isChildrenCircle,
        string? requestedAccessMode,
        bool requestedWaitingRoom,
        bool requestedAllowStudentScreenshare)
    {
        if (isChildrenCircle)
        {
            // Child-circle safety policy: private only, waiting room forced on,
            // students cannot share screen, and only teachers/supervisors can unmute students.
            return new EffectiveRoomSettings(
                AccessMode: "private",
                WaitingRoomEnabled: true,
                AllowStudentScreenshare: false,
                OnlyHostCanUnmute: true);
        }

        var normalizedMode = string.Equals(requestedAccessMode?.Trim(), "public", StringComparison.OrdinalIgnoreCase)
            ? "public"
            : "private";

        return new EffectiveRoomSettings(
            AccessMode: normalizedMode,
            WaitingRoomEnabled: requestedWaitingRoom,
            AllowStudentScreenshare: requestedAllowStudentScreenshare,
            OnlyHostCanUnmute: false);
    }

    public static bool IsHostUser(ClaimsPrincipal principal, Guid? circleTeacherId, Guid? callerTeacherId)
    {
        if (AdminHostPermissions.Any(code => principal.HasClaim("permission", code)))
            return true;

        if (principal.HasClaim("permission", "supervisor.portal") ||
            principal.FindAll("permission").Any(c => c.Value.StartsWith("supervisor.", StringComparison.Ordinal)))
            return true;

        if (circleTeacherId.HasValue && callerTeacherId.HasValue && circleTeacherId.Value == callerTeacherId.Value)
            return true;

        return false;
    }

    public static string[] ResolvePublishSources(
        bool isHost,
        bool isChildrenCircle,
        bool allowStudentScreenshare,
        bool mutedByHost)
    {
        if (isHost)
            return ["camera", "microphone", "screen_share", "screen_share_audio"];

        if (mutedByHost)
            return [];

        if (isChildrenCircle)
            return ["microphone"];

        return allowStudentScreenshare
            ? ["camera", "microphone", "screen_share"]
            : ["camera", "microphone"];
    }

    public static string SuggestAttendanceStatus(int attendedSeconds) =>
        attendedSeconds >= 60 ? "present" : "absent";
}
