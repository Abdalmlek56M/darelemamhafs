using Npgsql;

namespace Dar.Modules.Meet.Persistence;

public sealed partial class MeetBotJobRepository
{
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

    /// <summary>
    /// Stops a running recording or cancels a queued one. A scheduled job never reaches
    /// the bot, so it is cancelled here instead of waiting for a heartbeat.
    /// </summary>
}
