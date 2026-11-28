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

public sealed class LiveKitRoomRepository(NpgsqlDataSource db)
{
    public async Task<CircleMeta?> GetCircleAsync(Guid circleId, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand("""
            SELECT id, name, teacher_id, is_children
            FROM circles
            WHERE id = @id AND is_trashed = FALSE;
            """);
        cmd.Parameters.AddWithValue("id", circleId);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        return new CircleMeta(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetGuid(2),
            reader.GetBoolean(3));
    }

    public async Task<Guid?> FindActiveSessionIdAsync(Guid circleId, Guid? requestedSessionId, CancellationToken ct)
    {
        if (requestedSessionId.HasValue)
        {
            await using var check = db.CreateCommand("""
                SELECT ts.id
                FROM teacher_sessions ts
                JOIN circle_schedule_slots css ON css.id = ts.schedule_slot_id
                WHERE ts.id = @sid AND css.circle_id = @cid;
                """);
            check.Parameters.AddWithValue("sid", requestedSessionId.Value);
            check.Parameters.AddWithValue("cid", circleId);
            var matched = await check.ExecuteScalarAsync(ct);
            return matched is Guid g ? g : null;
        }

        await using var active = db.CreateCommand("""
            SELECT ts.id
            FROM teacher_sessions ts
            JOIN circle_schedule_slots css ON css.id = ts.schedule_slot_id
            WHERE css.circle_id = @cid AND ts.status IN ('in_progress', 'awaiting_attendance')
            ORDER BY ts.started_at DESC NULLS LAST, ts.created_at DESC
            LIMIT 1;
            """);
        active.Parameters.AddWithValue("cid", circleId);
        var scalar = await active.ExecuteScalarAsync(ct);
        return scalar is Guid id ? id : null;
    }

    public async Task<LiveKitRoomRecord?> GetOpenRoomByCircleAsync(Guid circleId, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand(RoomSelect + " WHERE r.circle_id = @cid AND r.status = 'open' ORDER BY r.created_at DESC LIMIT 1;");
        cmd.Parameters.AddWithValue("cid", circleId);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? ReadRoom(reader) : null;
    }

    public async Task<LiveKitRoomRecord?> GetRoomByInviteCodeAsync(string inviteCode, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand(RoomSelect + " WHERE r.invite_code = @code LIMIT 1;");
        cmd.Parameters.AddWithValue("code", inviteCode.Trim());
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? ReadRoom(reader) : null;
    }

    public async Task<LiveKitRoomRecord> CreateRoomAsync(
        CircleMeta circle,
        Guid? sessionId,
        EffectiveRoomSettings settings,
        Guid createdBy,
        string? title,
        CancellationToken ct)
    {
        var id = Guid.NewGuid();
        var suffix = id.ToString("N")[..10];
        var roomName = $"dar-{suffix}";
        var inviteCode = suffix;
        var resolvedTitle = string.IsNullOrWhiteSpace(title) ? circle.Name : title.Trim();

        await using var cmd = db.CreateCommand("""
            INSERT INTO livekit_rooms(
                id, room_name, invite_code, circle_id, session_id, title,
                access_mode, waiting_room_enabled, allow_student_screenshare, status, created_by
            )
            VALUES (@id, @roomName, @inviteCode, @circleId, @sessionId, @title,
                    @accessMode, @waitingRoom, @allowScreenshare, 'open', @createdBy);
            """);
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("roomName", roomName);
        cmd.Parameters.AddWithValue("inviteCode", inviteCode);
        cmd.Parameters.AddWithValue("circleId", circle.Id);
        cmd.Parameters.AddWithValue("sessionId", sessionId.HasValue ? (object)sessionId.Value : DBNull.Value);
        cmd.Parameters.AddWithValue("title", resolvedTitle);
        cmd.Parameters.AddWithValue("accessMode", settings.AccessMode);
        cmd.Parameters.AddWithValue("waitingRoom", settings.WaitingRoomEnabled);
        cmd.Parameters.AddWithValue("allowScreenshare", settings.AllowStudentScreenshare);
        cmd.Parameters.AddWithValue("createdBy", createdBy);
        await cmd.ExecuteNonQueryAsync(ct);

        return (await GetRoomByInviteCodeAsync(inviteCode, ct))!;
    }

    public async Task LinkSessionIfUnsetAsync(Guid roomId, Guid sessionId, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand("""
            UPDATE livekit_rooms
            SET session_id = @sid
            WHERE id = @rid AND session_id IS NULL;
            """);
        cmd.Parameters.AddWithValue("rid", roomId);
        cmd.Parameters.AddWithValue("sid", sessionId);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<bool> IsCircleMemberAsync(Guid userId, Guid circleId, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand("""
            SELECT EXISTS(
                SELECT 1
                FROM app_users u
                JOIN circle_enrollments ce ON ce.student_id = u.student_id
                WHERE u.id = @uid
                  AND ce.circle_id = @cid
                  AND ce.is_trashed = FALSE
                  AND ce.status IN ('active', 'paused')
            );
            """);
        cmd.Parameters.AddWithValue("uid", userId);
        cmd.Parameters.AddWithValue("cid", circleId);
        return (bool)(await cmd.ExecuteScalarAsync(ct) ?? false);
    }

    public async Task<ParticipantStateRecord> UpsertParticipantOnTokenRequestAsync(
        Guid roomId,
        Guid userId,
        string role,
        bool waitingRoomEnabled,
        CancellationToken ct)
    {
        var defaultStatus = role == "host" || !waitingRoomEnabled ? "admitted" : "pending";
        await using var cmd = db.CreateCommand("""
            INSERT INTO livekit_room_participants(room_id, user_id, role, admission_status)
            VALUES (@roomId, @userId, @role, @status)
            ON CONFLICT (room_id, user_id) DO UPDATE
            SET role = EXCLUDED.role,
                admission_status = CASE
                    WHEN livekit_room_participants.admission_status IN ('banned', 'denied') THEN livekit_room_participants.admission_status
                    WHEN EXCLUDED.role = 'host' THEN 'admitted'
                    WHEN NOT @waitingRoom THEN 'admitted'
                    ELSE livekit_room_participants.admission_status
                END,
                updated_at = now();
            """);
        cmd.Parameters.AddWithValue("roomId", roomId);
        cmd.Parameters.AddWithValue("userId", userId);
        cmd.Parameters.AddWithValue("role", role);
        cmd.Parameters.AddWithValue("status", defaultStatus);
        cmd.Parameters.AddWithValue("waitingRoom", waitingRoomEnabled);
        await cmd.ExecuteNonQueryAsync(ct);

        return (await GetParticipantAsync(roomId, userId, ct))!;
    }

    public async Task<ParticipantStateRecord?> GetParticipantAsync(Guid roomId, Guid userId, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand(ParticipantSelect + " WHERE p.room_id = @rid AND p.user_id = @uid LIMIT 1;");
        cmd.Parameters.AddWithValue("rid", roomId);
        cmd.Parameters.AddWithValue("uid", userId);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? ReadParticipant(reader) : null;
    }

    private const string RoomSelect = """
        SELECT r.id, r.room_name, r.invite_code, r.circle_id, c.name, c.teacher_id, c.is_children,
               r.session_id, r.title, r.access_mode, r.waiting_room_enabled, r.allow_student_screenshare,
               r.status, r.created_at
        FROM livekit_rooms r
        JOIN circles c ON c.id = r.circle_id
        """;

    private static LiveKitRoomRecord ReadRoom(NpgsqlDataReader r) => new(
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

    private const string ParticipantSelect = """
        SELECT p.id, p.room_id, p.user_id, u.username, u.display_name, p.role, p.admission_status,
               p.muted_by_host, p.first_joined_at, p.last_joined_at, p.last_left_at,
               p.attended_seconds, p.is_connected
        FROM livekit_room_participants p
        JOIN app_users u ON u.id = p.user_id
        """;

    private static ParticipantStateRecord ReadParticipant(NpgsqlDataReader r) => new(
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
