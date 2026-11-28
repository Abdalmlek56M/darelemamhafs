using Npgsql;

namespace Dar.Modules.Meet.LiveKit;

public sealed record CircleMeta(
    Guid Id,
    string Name,
    Guid? TeacherId,
    bool IsChildren);

public sealed record LiveKitRoomRecord(
    Guid Id,
    string RoomName,
    string InviteCode,
    Guid CircleId,
    string CircleName,
    Guid? CircleTeacherId,
    bool IsChildren,
    Guid? SessionId,
    string Title,
    string AccessMode,
    bool WaitingRoomEnabled,
    bool AllowStudentScreenshare,
    string Status,
    DateTimeOffset CreatedAt);

public sealed record ParticipantStateRecord(
    Guid Id,
    Guid RoomId,
    Guid UserId,
    string Username,
    string DisplayName,
    string Role,
    string AdmissionStatus,
    bool MutedByHost,
    DateTimeOffset? FirstJoinedAt,
    DateTimeOffset? LastJoinedAt,
    DateTimeOffset? LastLeftAt,
    int AttendedSeconds,
    bool IsConnected);

/// <summary>
/// Shared SQL fragments and data readers used by LiveKit repositories.
/// </summary>
internal static class LiveKitRoomSql
{
    public const string RoomSelect = """
        SELECT r.id, r.room_name, r.invite_code, r.circle_id, c.name, c.teacher_id, c.is_children,
               r.session_id, r.title, r.access_mode, r.waiting_room_enabled, r.allow_student_screenshare,
               r.status, r.created_at
        FROM livekit_rooms r
        JOIN circles c ON c.id = r.circle_id
        """;

    public const string ParticipantSelect = """
        SELECT p.id, p.room_id, p.user_id, u.username, u.display_name, p.role, p.admission_status,
               p.muted_by_host, p.first_joined_at, p.last_joined_at, p.last_left_at,
               p.attended_seconds, p.is_connected
        FROM livekit_room_participants p
        JOIN app_users u ON u.id = p.user_id
        """;

    public static string ElapsedSecondsExpr(string prefix = "") => $"""
        CASE
            WHEN {prefix}is_connected AND {prefix}last_joined_at IS NOT NULL
            THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - {prefix}last_joined_at)))::int)
            ELSE 0
        END
        """;

    public static LiveKitRoomRecord ReadRoom(NpgsqlDataReader r) => new(
        r.GetGuid(0),
        r.GetString(1),
        r.GetString(2),
        r.GetGuid(3),
        r.GetString(4),
        r.IsDBNull(5) ? null : r.GetGuid(5),
        r.GetBoolean(6),
        r.IsDBNull(7) ? null : r.GetGuid(7),
        r.GetString(8),
        r.GetString(9),
        r.GetBoolean(10),
        r.GetBoolean(11),
        r.GetString(12),
        r.GetFieldValue<DateTimeOffset>(13));

    public static ParticipantStateRecord ReadParticipant(NpgsqlDataReader r) => new(
        r.GetGuid(0),
        r.GetGuid(1),
        r.GetGuid(2),
        r.GetString(3),
        r.GetString(4),
        r.GetString(5),
        r.GetString(6),
        r.GetBoolean(7),
        r.IsDBNull(8) ? null : r.GetFieldValue<DateTimeOffset>(8),
        r.IsDBNull(9) ? null : r.GetFieldValue<DateTimeOffset>(9),
        r.IsDBNull(10) ? null : r.GetFieldValue<DateTimeOffset>(10),
        r.GetInt32(11),
        r.GetBoolean(12));
}
