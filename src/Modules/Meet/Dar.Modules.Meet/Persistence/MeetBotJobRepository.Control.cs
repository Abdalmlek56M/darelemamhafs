using Npgsql;

namespace Dar.Modules.Meet.Persistence;

public sealed partial class MeetBotJobRepository
{
    public async Task<bool> RequestStopAsync(Guid jobId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            WITH running AS (
                UPDATE meet_bot_jobs
                SET stop_requested_at = now(), updated_at = now()
                WHERE id = @id AND status IN ('joining', 'live', 'finalizing', 'uploading')
                RETURNING id
            ), queued AS (
                UPDATE meet_bot_jobs
                SET status = 'cancelled',
                    error_code = 'manual_cancel',
                    error_message = 'أُلغي من لوحة التحكم قبل بدء التسجيل.',
                    finished_at = now(),
                    updated_at = now()
                WHERE id = @id AND status IN ('scheduled', 'waiting')
                RETURNING id
            )
            SELECT (SELECT count(*) FROM running) + (SELECT count(*) FROM queued);
            """, connection);
        command.Parameters.AddWithValue("id", jobId);
        return Convert.ToInt32(await command.ExecuteScalarAsync(ct) ?? 0) > 0;
    }

    /// <summary>Freezes or resumes the active capture.</summary>
    public async Task<bool> SetPausedAsync(Guid jobId, bool paused, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            UPDATE meet_bot_jobs
            SET pause_requested = @paused, updated_at = now()
            WHERE id = @id AND status IN ('joining', 'live')
            RETURNING id;
            """, connection);
        command.Parameters.AddWithValue("id", jobId);
        command.Parameters.AddWithValue("paused", paused);
        return await command.ExecuteScalarAsync(ct) is Guid;
    }

    /// <summary>Commands the bot polls on every heartbeat.</summary>
    public async Task<(bool Stop, bool Pause)> GetCommandsAsync(Guid jobId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT stop_requested_at IS NOT NULL, pause_requested FROM meet_bot_jobs WHERE id = @id;
            """, connection);
        command.Parameters.AddWithValue("id", jobId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? (reader.GetBoolean(0), reader.GetBoolean(1)) : (false, false);
    }

    /// <summary>Stores the participants count and audio health reported by the bot.</summary>
    public async Task RecordTelemetryAsync(Guid jobId, int? participants, bool? audioOk, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            UPDATE meet_bot_jobs
            SET participants = COALESCE(@participants, participants),
                audio_ok = COALESCE(@audio, audio_ok),
                updated_at = now()
            WHERE id = @id;
            UPDATE meet_sessions
            SET participants = COALESCE(@participants, participants), updated_at = now()
            WHERE job_id = @id AND status = 'live';
            """, connection);
        command.Parameters.AddWithValue("id", jobId);
        command.Parameters.AddWithValue("participants", (object?)participants ?? DBNull.Value);
        command.Parameters.AddWithValue("audio", (object?)audioOk ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Fails jobs whose bot stopped heartbeating (service restart, crash) and closes their
    /// sessions as partial, so the queue never stays blocked behind a dead recording.
    /// </summary>
    public async Task<int> ReapStalledAsync(int staleSeconds, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            WITH dead AS (
                UPDATE meet_bot_jobs
                SET status = 'failed',
                    error_code = 'stalled',
                    error_message = 'انقطع اتصال البوت أثناء التسجيل (إعادة تشغيل أو انهيار).',
                    finished_at = now(),
                    updated_at = now()
                WHERE status IN ('joining', 'live', 'finalizing', 'uploading')
                  AND (heartbeat_at IS NULL OR heartbeat_at < now() - make_interval(secs => @stale))
                RETURNING id
            )
            UPDATE meet_sessions s
            SET status = 'partial', ended_at = COALESCE(s.ended_at, now()), updated_at = now()
            FROM dead
            WHERE s.job_id = dead.id AND s.status = 'live';
            """, connection);
        command.Parameters.AddWithValue("stale", staleSeconds);
        return await command.ExecuteNonQueryAsync(ct);
    }

    /// <summary>Current (or next) job for the control panel.</summary>
    public async Task<ActiveJobRow?> GetActiveAsync(CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT j.id, j.status, COALESCE(j.summary, e.summary), COALESCE(j.meet_link, e.meet_link),
                   j.started_at, j.scheduled_end, j.participants, j.pause_requested,
                   j.stop_requested_at IS NOT NULL
            FROM meet_bot_jobs j
            LEFT JOIN meet_events e ON e.id = j.event_id
            WHERE j.status IN ('scheduled', 'joining', 'live', 'finalizing', 'uploading')
            ORDER BY CASE WHEN j.status = 'scheduled' THEN 1 ELSE 0 END, j.join_at DESC
            LIMIT 1;
            """, connection);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        return new ActiveJobRow(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetFieldValue<DateTimeOffset>(4),
            reader.GetFieldValue<DateTimeOffset>(5),
            reader.IsDBNull(6) ? null : reader.GetInt32(6),
            reader.GetBoolean(7),
            reader.GetBoolean(8));
    }

    public async Task<BotQueueSnapshot> SnapshotAsync(int staleSeconds, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT
              COUNT(*) FILTER (WHERE status = 'scheduled')::int,
              COUNT(*) FILTER (WHERE status IN ('waiting', 'joining', 'live', 'finalizing', 'uploading'))::int,
              COUNT(*) FILTER (WHERE status IN ('joining', 'live')
                                 AND COALESCE(heartbeat_at, claimed_at, now()) < now() - make_interval(secs => @stale))::int
            FROM meet_bot_jobs;
            """, connection);
        command.Parameters.AddWithValue("stale", staleSeconds);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return new BotQueueSnapshot(0, 0, 0);
        return new BotQueueSnapshot(reader.GetInt32(0), reader.GetInt32(1), reader.GetInt32(2));
    }
}
