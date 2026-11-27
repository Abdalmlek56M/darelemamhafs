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
public sealed partial class MeetBotJobRepository
{
    private readonly NpgsqlDataSource dataSource;

    public MeetBotJobRepository(NpgsqlDataSource dataSource) => this.dataSource = dataSource;

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
}
