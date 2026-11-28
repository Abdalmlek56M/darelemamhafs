using Npgsql;

namespace Dar.Modules.Meet.LiveKit;

/// <summary>
/// Manages LiveKit room metadata, circle links, access policy updates, and room teardown.
/// </summary>
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
        await using var cmd = db.CreateCommand(LiveKitRoomSql.RoomSelect + " WHERE r.circle_id = @cid AND r.status = 'open' ORDER BY r.created_at DESC LIMIT 1;");
        cmd.Parameters.AddWithValue("cid", circleId);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? LiveKitRoomSql.ReadRoom(reader) : null;
    }

    public async Task<LiveKitRoomRecord?> GetRoomByInviteCodeAsync(string inviteCode, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand(LiveKitRoomSql.RoomSelect + " WHERE r.invite_code = @code LIMIT 1;");
        cmd.Parameters.AddWithValue("code", inviteCode.Trim());
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? LiveKitRoomSql.ReadRoom(reader) : null;
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

    public async Task<LiveKitRoomRecord?> UpdateAccessSettingsAsync(
        Guid roomId,
        string inviteCode,
        EffectiveRoomSettings settings,
        CancellationToken ct)
    {
        await using var cmd = db.CreateCommand("""
            UPDATE livekit_rooms
            SET access_mode = @accessMode,
                waiting_room_enabled = @waitingRoom,
                allow_student_screenshare = @allowScreenshare
            WHERE id = @rid AND status = 'open';
            """);
        cmd.Parameters.AddWithValue("rid", roomId);
        cmd.Parameters.AddWithValue("accessMode", settings.AccessMode);
        cmd.Parameters.AddWithValue("waitingRoom", settings.WaitingRoomEnabled);
        cmd.Parameters.AddWithValue("allowScreenshare", settings.AllowStudentScreenshare);
        await cmd.ExecuteNonQueryAsync(ct);
        return await GetRoomByInviteCodeAsync(inviteCode, ct);
    }

    public async Task EndRoomAsync(Guid roomId, CancellationToken ct)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        var closeSql = $"""
            UPDATE livekit_room_participants
            SET attended_seconds = attended_seconds + {LiveKitRoomSql.ElapsedSecondsExpr()},
                is_connected = FALSE,
                last_left_at = CASE WHEN is_connected THEN now() ELSE last_left_at END,
                updated_at = now()
            WHERE room_id = @rid;
            """;
        await using (var closeParts = new NpgsqlCommand(closeSql, conn, tx))
        {
            closeParts.Parameters.AddWithValue("rid", roomId);
            await closeParts.ExecuteNonQueryAsync(ct);
        }
        await using (var endCmd = new NpgsqlCommand("""
            UPDATE livekit_rooms
            SET status = 'ended', ended_at = COALESCE(ended_at, now())
            WHERE id = @rid;
            """, conn, tx))
        {
            endCmd.Parameters.AddWithValue("rid", roomId);
            await endCmd.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
    }
}
