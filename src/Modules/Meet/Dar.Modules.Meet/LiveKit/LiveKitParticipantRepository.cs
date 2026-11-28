using Npgsql;

namespace Dar.Modules.Meet.LiveKit;

/// <summary>
/// Manages LiveKit room participant state, host moderation flags, and attendance duration tracking.
/// </summary>
public sealed class LiveKitParticipantRepository(NpgsqlDataSource db)
{
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
        await using var cmd = db.CreateCommand(LiveKitRoomSql.ParticipantSelect + " WHERE p.room_id = @rid AND p.user_id = @uid LIMIT 1;");
        cmd.Parameters.AddWithValue("rid", roomId);
        cmd.Parameters.AddWithValue("uid", userId);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? LiveKitRoomSql.ReadParticipant(reader) : null;
    }

    public async Task<IReadOnlyList<ParticipantStateRecord>> ListParticipantsAsync(Guid roomId, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand(LiveKitRoomSql.ParticipantSelect + " WHERE p.room_id = @rid ORDER BY CASE p.role WHEN 'host' THEN 0 ELSE 1 END, u.display_name;");
        cmd.Parameters.AddWithValue("rid", roomId);
        var list = new List<ParticipantStateRecord>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) list.Add(LiveKitRoomSql.ReadParticipant(reader));
        return list;
    }

    public async Task ModerateParticipantAsync(Guid roomId, Guid targetUserId, string action, CancellationToken ct)
    {
        var setClause = action switch
        {
            "mute" => "muted_by_host = TRUE",
            "unmute" => "muted_by_host = FALSE",
            "admit" => "admission_status = 'admitted'",
            "deny" => "admission_status = 'denied', is_connected = FALSE",
            "remove" => "is_connected = FALSE",
            "ban" => "admission_status = 'banned', is_connected = FALSE",
            _ => throw new ArgumentOutOfRangeException(nameof(action)),
        };
        await using var cmd = db.CreateCommand($"UPDATE livekit_room_participants SET {setClause}, updated_at = now() WHERE room_id = @rid AND user_id = @uid;");
        cmd.Parameters.AddWithValue("rid", roomId);
        cmd.Parameters.AddWithValue("uid", targetUserId);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<int> RecordAttendanceEventAsync(Guid roomId, Guid userId, string kind, CancellationToken ct)
    {
        var elapsed = LiveKitRoomSql.ElapsedSecondsExpr();
        var sql = kind switch
        {
            "join" => """
                UPDATE livekit_room_participants
                SET first_joined_at = COALESCE(first_joined_at, now()),
                    last_joined_at = now(),
                    is_connected = TRUE,
                    updated_at = now()
                WHERE room_id = @rid AND user_id = @uid AND admission_status = 'admitted'
                RETURNING attended_seconds;
                """,
            "heartbeat" => $"""
                UPDATE livekit_room_participants
                SET attended_seconds = attended_seconds + {elapsed},
                    last_joined_at = now(),
                    is_connected = TRUE,
                    updated_at = now()
                WHERE room_id = @rid AND user_id = @uid AND admission_status = 'admitted'
                RETURNING attended_seconds;
                """,
            "leave" => $"""
                UPDATE livekit_room_participants
                SET attended_seconds = attended_seconds + {elapsed},
                    last_left_at = now(),
                    is_connected = FALSE,
                    updated_at = now()
                WHERE room_id = @rid AND user_id = @uid
                RETURNING attended_seconds;
                """,
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };

        await using var cmd = db.CreateCommand(sql);
        cmd.Parameters.AddWithValue("rid", roomId);
        cmd.Parameters.AddWithValue("uid", userId);
        var result = await cmd.ExecuteScalarAsync(ct);
        return result is int seconds ? seconds : 0;
    }

    public async Task<(Guid? RoomId, int TeacherAttendedMinutes, IReadOnlyList<(Guid StudentId, Guid UserId, int AttendedMinutes, string SuggestedStatus)> Students)>
        GetSessionAttendanceSuggestionsAsync(Guid sessionId, CancellationToken ct)
    {
        await using var roomCmd = db.CreateCommand("""
            SELECT r.id
            FROM livekit_rooms r
            WHERE r.session_id = @sid
            ORDER BY r.created_at DESC
            LIMIT 1;
            """);
        roomCmd.Parameters.AddWithValue("sid", sessionId);
        var roomObj = await roomCmd.ExecuteScalarAsync(ct);
        if (roomObj is not Guid roomId)
            return (null, 0, []);

        var teacherSeconds = 0;
        var students = new List<(Guid, Guid, int, string)>();
        var partSql = $"""
            SELECT p.role, p.user_id, u.student_id,
                   p.attended_seconds + {LiveKitRoomSql.ElapsedSecondsExpr("p.")} AS effective_seconds
            FROM livekit_room_participants p
            JOIN app_users u ON u.id = p.user_id
            WHERE p.room_id = @rid;
            """;
        await using var partCmd = db.CreateCommand(partSql);
        partCmd.Parameters.AddWithValue("rid", roomId);
        await using var reader = await partCmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var role = reader.GetString(0);
            var userId = reader.GetGuid(1);
            var studentId = reader.IsDBNull(2) ? (Guid?)null : reader.GetGuid(2);
            var seconds = reader.GetInt32(3);
            var minutes = (int)Math.Round(seconds / 60.0, MidpointRounding.AwayFromZero);

            if (role == "host")
            {
                teacherSeconds = Math.Max(teacherSeconds, seconds);
            }
            else if (studentId.HasValue)
            {
                students.Add((studentId.Value, userId, minutes, LiveKitRoomPolicy.SuggestAttendanceStatus(seconds)));
            }
        }

        var teacherMinutes = (int)Math.Round(teacherSeconds / 60.0, MidpointRounding.AwayFromZero);
        return (roomId, teacherMinutes, students);
    }
}
