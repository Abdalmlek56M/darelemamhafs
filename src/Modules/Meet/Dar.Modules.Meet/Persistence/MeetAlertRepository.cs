using Npgsql;

namespace Dar.Modules.Meet.Persistence;

public sealed record MeetAlertRow(
    Guid Id,
    string Severity,
    string Code,
    string Title,
    string? Body,
    DateTimeOffset CreatedAt,
    bool IsRead);

/// <summary>
/// Operational alerts shown to the owner: the bot leaving, a dead Google session, a failed
/// join or a full disk must never be discovered days later.
/// </summary>
public sealed class MeetAlertRepository(NpgsqlDataSource dataSource)
{
    public async Task<Guid> CreateAsync(
        string severity,
        string code,
        string title,
        string? body,
        Guid? jobId,
        Guid? sessionId,
        CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            INSERT INTO meet_alerts(severity, code, title, body, job_id, session_id)
            VALUES (@severity, @code, @title, @body, @job, @session)
            RETURNING id;
            """, connection);
        command.Parameters.AddWithValue("severity", severity);
        command.Parameters.AddWithValue("code", code);
        command.Parameters.AddWithValue("title", title);
        command.Parameters.AddWithValue("body", (object?)body ?? DBNull.Value);
        command.Parameters.AddWithValue("job", (object?)jobId ?? DBNull.Value);
        command.Parameters.AddWithValue("session", (object?)sessionId ?? DBNull.Value);
        return (Guid)(await command.ExecuteScalarAsync(ct))!;
    }

    public async Task<IReadOnlyList<MeetAlertRow>> ListAsync(int limit, bool unreadOnly, CancellationToken ct)
    {
        var rows = new List<MeetAlertRow>();
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT id, severity, code, title, body, created_at, read_at IS NOT NULL
            FROM meet_alerts
            WHERE (@unread = FALSE OR read_at IS NULL)
            ORDER BY created_at DESC
            LIMIT @limit;
            """, connection);
        command.Parameters.AddWithValue("unread", unreadOnly);
        command.Parameters.AddWithValue("limit", Math.Clamp(limit, 1, 200));
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            rows.Add(new MeetAlertRow(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.GetFieldValue<DateTimeOffset>(5),
                reader.GetBoolean(6)));
        }
        return rows;
    }

    public async Task<int> MarkReadAsync(Guid? id, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            UPDATE meet_alerts SET read_at = now()
            WHERE read_at IS NULL AND (@id::uuid IS NULL OR id = @id);
            """, connection);
        command.Parameters.AddWithValue("id", (object?)id ?? DBNull.Value);
        return await command.ExecuteNonQueryAsync(ct);
    }
}
