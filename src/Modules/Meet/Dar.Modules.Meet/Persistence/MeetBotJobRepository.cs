using Npgsql;

namespace Dar.Modules.Meet.Persistence;

public sealed record BotJobClaim(
    Guid Id,
    Guid EventId,
    string OccurrenceKey,
    string Status,
    DateTimeOffset ScheduledStart,
    DateTimeOffset ScheduledEnd,
    DateTimeOffset JoinAt,
    Guid? CircleId,
    string? Summary,
    string? MeetLink,
    int StopGraceSeconds,
    int JoinLeadSeconds,
    string AccessType,
    int MaxSessionMinutes,
    int IdleStopSeconds);

public sealed record BotQueueSnapshot(int Pending, int Active, int Stale);

/// <summary>What the control panel shows about the current recording.</summary>
public sealed record ActiveJobRow(
    Guid Id,
    string Status,
    string? Summary,
    string? MeetLink,
    DateTimeOffset? StartedAt,
    DateTimeOffset ScheduledEnd,
    int? Participants,
    bool Paused,
    bool StopRequested);

/// <summary>One produced file reported by the bot when a recording finishes.</summary>
public sealed record BotArtifact(
    string Kind,
    string LocalPath,
    long SizeBytes,
    string? Sha256,
    int DurationSeconds,
    short PartNo = 1);

/// <summary>
/// Durable recording queue. The bot claims a job atomically with SKIP LOCKED so two
/// workers can never pick the same occurrence (ADR-0007).
/// </summary>
public sealed class MeetBotJobRepository(NpgsqlDataSource dataSource)
{
    public async Task<BotJobClaim?> ClaimNextAsync(string worker, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        BotJobClaim? job = null;
        await using (var select = new NpgsqlCommand("""
            SELECT j.id, j.event_id, j.occurrence_key, j.scheduled_start, j.scheduled_end, j.join_at,
                   j.circle_id, COALESCE(j.summary, e.summary), COALESCE(j.meet_link, e.meet_link),
                   s.stop_grace_seconds, s.join_lead_seconds,
                   COALESCE(e.access_type, s.default_access_type), s.max_session_minutes,
                   s.idle_stop_seconds
            FROM meet_bot_jobs j
            LEFT JOIN meet_events e ON e.id = j.event_id
            CROSS JOIN meet_settings s
            WHERE s.id = TRUE
              AND j.status = 'scheduled'
              AND j.join_at <= now()
              -- One concurrent recording (owner decision): never claim while another is active,
              -- and never let a job with a dead heartbeat block the queue.
              AND NOT EXISTS (
                    SELECT 1 FROM meet_bot_jobs a
                    WHERE a.status IN ('joining', 'live', 'finalizing', 'uploading')
                      AND a.heartbeat_at > now() - interval '150 seconds')
            ORDER BY j.join_at
            FOR UPDATE OF j SKIP LOCKED
            LIMIT 1;
            """, connection, transaction))
        {
            await using var reader = await select.ExecuteReaderAsync(ct);
            if (await reader.ReadAsync(ct))
            {
                job = new BotJobClaim(
                    reader.GetGuid(0),
                    reader.IsDBNull(1) ? Guid.Empty : reader.GetGuid(1),
                    reader.GetString(2),
                    "scheduled",
                    reader.GetFieldValue<DateTimeOffset>(3),
                    reader.GetFieldValue<DateTimeOffset>(4),
                    reader.GetFieldValue<DateTimeOffset>(5),
                    reader.IsDBNull(6) ? null : reader.GetGuid(6),
                    reader.IsDBNull(7) ? null : reader.GetString(7),
                    reader.IsDBNull(8) ? null : reader.GetString(8),
                    reader.GetInt32(9),
                    reader.GetInt32(10),
                    reader.GetString(11),
                    reader.GetInt32(12),
                    reader.GetInt32(13));
            }
        }

        if (job is not null)
        {
            await using var update = new NpgsqlCommand("""
                UPDATE meet_bot_jobs
                SET status = 'joining',
                    attempts = attempts + 1,
                    claimed_at = now(),
                    claimed_by = @worker,
                    heartbeat_at = now(),
                    updated_at = now()
                WHERE id = @id;
                """, connection, transaction);
            update.Parameters.AddWithValue("id", job.Id);
            update.Parameters.AddWithValue("worker", worker.Length <= 120 ? worker : worker[..120]);
            await update.ExecuteNonQueryAsync(ct);
            job = job with { Status = "joining" };
        }

        await transaction.CommitAsync(ct);
        return job;
    }

    public async Task<bool> HeartbeatAsync(Guid jobId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            UPDATE meet_bot_jobs
            SET heartbeat_at = now(), updated_at = now()
            WHERE id = @id
              AND status IN ('waiting', 'joining', 'live', 'finalizing', 'uploading')
            RETURNING id;
            """, connection);
        command.Parameters.AddWithValue("id", jobId);
        return await command.ExecuteScalarAsync(ct) is Guid;
    }

    /// <summary>Returns the rejection reason, or null when the transition was applied.</summary>
    public async Task<string?> SetStatusAsync(
        Guid jobId,
        string status,
        string? errorCode,
        string? errorMessage,
        CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        string current;
        await using (var read = new NpgsqlCommand("SELECT status FROM meet_bot_jobs WHERE id = @id FOR UPDATE;", connection, transaction))
        {
            read.Parameters.AddWithValue("id", jobId);
            var value = await read.ExecuteScalarAsync(ct);
            if (value is not string existing) return "job_not_found";
            current = existing;
        }

        if (!Domain.MeetJobStates.CanTransition(current, status))
            return $"invalid_transition:{current}->{status}";

        await using (var update = new NpgsqlCommand("""
            UPDATE meet_bot_jobs
            SET status = @status,
                error_code = @code,
                error_message = @message,
                started_at = CASE WHEN @status = 'live' THEN COALESCE(started_at, now()) ELSE started_at END,
                finished_at = CASE WHEN @status IN ('ready', 'failed', 'cancelled') THEN now() ELSE finished_at END,
                heartbeat_at = now(),
                updated_at = now()
            WHERE id = @id;
            """, connection, transaction))
        {
            update.Parameters.AddWithValue("id", jobId);
            update.Parameters.AddWithValue("status", status);
            update.Parameters.AddWithValue("code", (object?)errorCode ?? DBNull.Value);
            update.Parameters.AddWithValue("message", (object?)(errorMessage is { Length: > 1000 } text ? text[..1000] : errorMessage) ?? DBNull.Value);
            await update.ExecuteNonQueryAsync(ct);
        }

        await transaction.CommitAsync(ct);
        return null;
    }

    /// <summary>
    /// Creates jobs for events that should be recorded: linked to a circle the owner selected
    /// (or forced on the event) with a Meet link, starting inside the scheduling horizon.
    /// Idempotent through the (event, start) check and the occurrence_key unique index.
    /// </summary>
    public async Task<int> ScheduleDueAsync(int horizonMinutes, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            INSERT INTO meet_bot_jobs(event_id, occurrence_key, circle_id, scheduled_start, scheduled_end, join_at)
            SELECT e.id,
                   e.id::text || ':' || to_char(e.occurrence_start AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS'),
                   l.circle_id,
                   e.occurrence_start,
                   e.occurrence_end,
                   e.occurrence_start - make_interval(secs => s.join_lead_seconds)
            FROM meet_events e
            LEFT JOIN meet_event_links l ON l.event_id = e.id
            LEFT JOIN meet_circle_settings cs ON cs.circle_id = l.circle_id
            CROSS JOIN meet_settings s
            WHERE s.id = TRUE
              AND e.occurrence_start > now()
              AND e.occurrence_start <= now() + make_interval(mins => @horizon)
              AND e.google_status <> 'cancelled'
              AND e.meet_link IS NOT NULL
              AND e.recording_mode <> 'exclude'
              AND (e.recording_mode = 'force'
                   OR (l.circle_id IS NOT NULL AND COALESCE(cs.auto_record, FALSE)))
              AND NOT EXISTS (
                    SELECT 1 FROM meet_bot_jobs j
                    WHERE j.event_id = e.id AND j.scheduled_start = e.occurrence_start)
            ON CONFLICT (occurrence_key) DO NOTHING;
            """, connection);
        command.Parameters.AddWithValue("horizon", horizonMinutes);
        return await command.ExecuteNonQueryAsync(ct);
    }

    /// <summary>Cancels jobs whose calendar event was cancelled or removed.</summary>
    public async Task<int> CancelOrphanedAsync(CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            UPDATE meet_bot_jobs j
            SET status = 'cancelled',
                error_code = 'event_cancelled',
                error_message = 'أُلغي الحدث من تقويم Google.',
                finished_at = now(),
                updated_at = now()
            FROM meet_events e
            WHERE j.event_id = e.id
              AND j.manual = FALSE
              AND j.status IN ('scheduled', 'waiting')
              AND e.google_status = 'cancelled';
            """, connection);
        return await command.ExecuteNonQueryAsync(ct);
    }

    /// <summary>Creates (or returns) the recording session row when the bot goes live.</summary>
    public async Task<Guid?> EnsureSessionAsync(Guid jobId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            INSERT INTO meet_sessions(job_id, event_id, circle_id, status, scheduled_end)
            SELECT j.id, j.event_id, j.circle_id, 'live', j.scheduled_end
            FROM meet_bot_jobs j
            WHERE j.id = @job
              AND NOT EXISTS (SELECT 1 FROM meet_sessions s WHERE s.job_id = j.id)
            RETURNING id;
            """, connection);
        command.Parameters.AddWithValue("job", jobId);
        var created = await command.ExecuteScalarAsync(ct);
        if (created is Guid id) return id;

        await using var existing = new NpgsqlCommand(
            "SELECT id FROM meet_sessions WHERE job_id = @job ORDER BY started_at DESC LIMIT 1;", connection);
        existing.Parameters.AddWithValue("job", jobId);
        return await existing.ExecuteScalarAsync(ct) as Guid?;
    }

    /// <summary>Closes the session and stores the produced MP4/HLS/poster metadata.</summary>
    public async Task FinishSessionAsync(
        Guid jobId,
        string sessionStatus,
        int durationSeconds,
        IReadOnlyList<BotArtifact> artifacts,
        CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        Guid? sessionId = null;
        await using (var close = new NpgsqlCommand("""
            UPDATE meet_sessions
            SET status = @status,
                ended_at = COALESCE(ended_at, now()),
                duration_seconds = @duration,
                updated_at = now()
            WHERE job_id = @job
            RETURNING id;
            """, connection, transaction))
        {
            close.Parameters.AddWithValue("job", jobId);
            close.Parameters.AddWithValue("status", sessionStatus);
            close.Parameters.AddWithValue("duration", durationSeconds);
            sessionId = await close.ExecuteScalarAsync(ct) as Guid?;
        }

        if (sessionId is { } id)
        {
            foreach (var artifact in artifacts)
            {
                await using var insert = new NpgsqlCommand("""
                    INSERT INTO meet_media_assets(session_id, kind, part_no, local_path, size_bytes, sha256, duration_seconds, status)
                    VALUES (@session, @kind, @part, @path, @size, @sha, @duration, 'local')
                    ON CONFLICT (session_id, kind, part_no) DO UPDATE
                    SET local_path = EXCLUDED.local_path,
                        size_bytes = EXCLUDED.size_bytes,
                        sha256 = EXCLUDED.sha256,
                        duration_seconds = EXCLUDED.duration_seconds,
                        updated_at = now();
                    """, connection, transaction);
                insert.Parameters.AddWithValue("session", id);
                insert.Parameters.AddWithValue("kind", artifact.Kind);
                insert.Parameters.AddWithValue("part", artifact.PartNo);
                insert.Parameters.AddWithValue("path", artifact.LocalPath);
                insert.Parameters.AddWithValue("size", artifact.SizeBytes);
                insert.Parameters.AddWithValue("sha", (object?)artifact.Sha256 ?? DBNull.Value);
                insert.Parameters.AddWithValue("duration", artifact.DurationSeconds);
                await insert.ExecuteNonQueryAsync(ct);
            }
        }

        await transaction.CommitAsync(ct);
    }

    /// <summary>
    /// Queues an immediate recording for any Google Meet link the owner pastes, without a
    /// calendar event. The caller has already validated the host (Meet only).
    /// </summary>
    public async Task<Guid> CreateManualJobAsync(
        string meetLink,
        string? summary,
        Guid createdBy,
        int maxSessionSeconds,
        CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            INSERT INTO meet_bot_jobs(event_id, occurrence_key, circle_id, scheduled_start,
                                      scheduled_end, join_at, status, meet_link, summary, manual, created_by)
            VALUES (NULL, 'manual:' || gen_random_uuid()::text, NULL, now(),
                    now() + make_interval(secs => @max), now(), 'scheduled',
                    @link, @summary, TRUE, @user)
            RETURNING id;
            """, connection);
        command.Parameters.AddWithValue("link", meetLink);
        command.Parameters.AddWithValue("summary", (object?)summary ?? DBNull.Value);
        command.Parameters.AddWithValue("user", createdBy);
        command.Parameters.AddWithValue("max", maxSessionSeconds);
        return (Guid)(await command.ExecuteScalarAsync(ct))!;
    }

    /// <summary>Asks the running bot to stop; it finalises on its next heartbeat.</summary>
    public async Task<bool> RequestStopAsync(Guid jobId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            UPDATE meet_bot_jobs
            SET stop_requested_at = now(), updated_at = now()
            WHERE id = @id AND status IN ('joining', 'live', 'finalizing', 'uploading')
            RETURNING id;
            """, connection);
        command.Parameters.AddWithValue("id", jobId);
        return await command.ExecuteScalarAsync(ct) is Guid;
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
