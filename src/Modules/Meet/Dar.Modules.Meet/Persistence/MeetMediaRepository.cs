using Dar.Modules.Meet.Application;
using Npgsql;

namespace Dar.Modules.Meet.Persistence;

public sealed record MeetSessionRow(
    Guid Id,
    string? Summary,
    string? CircleName,
    DateTimeOffset StartedAt,
    int? DurationSeconds,
    string Status,
    Guid? Mp4AssetId,
    long? Mp4SizeBytes,
    Guid? PosterAssetId,
    bool UploadedToDrive);

public sealed record MeetMediaAssetRow(
    Guid Id,
    Guid SessionId,
    string Kind,
    string LocalPath,
    string Status,
    long? SizeBytes);

/// <summary>Read model for the recordings screen (list sessions and stream their assets).</summary>
public sealed class MeetMediaRepository(NpgsqlDataSource dataSource)
{
    public async Task<IReadOnlyList<MeetSessionRow>> ListSessionsAsync(int limit, MeetAccessScope scope, CancellationToken ct)
    {
        var rows = new List<MeetSessionRow>();
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT s.id, e.summary, c.name, s.started_at, s.duration_seconds, s.status,
                   mp4.id, mp4.size_bytes, poster.id,
                   COALESCE(mp4.verified_on_drive, FALSE)
            FROM meet_sessions s
            LEFT JOIN meet_events e ON e.id = s.event_id
            LEFT JOIN circles c ON c.id = s.circle_id
            LEFT JOIN meet_media_assets mp4
                   ON mp4.session_id = s.id AND mp4.kind = 'mp4' AND mp4.status <> 'deleted'
            LEFT JOIN meet_media_assets poster
                   ON poster.session_id = s.id AND poster.kind = 'poster' AND poster.status <> 'deleted'
            WHERE (@all OR s.circle_id = ANY(@circles))
            ORDER BY s.started_at DESC
            LIMIT @limit;
            """, connection);
        command.Parameters.AddWithValue("limit", Math.Clamp(limit, 1, 200));
        command.Parameters.AddWithValue("all", scope.All);
        command.Parameters.AddWithValue("circles", scope.CircleIds);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            rows.Add(new MeetSessionRow(
                reader.GetGuid(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetFieldValue<DateTimeOffset>(3),
                reader.IsDBNull(4) ? null : reader.GetInt32(4),
                reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetGuid(6),
                reader.IsDBNull(7) ? null : reader.GetInt64(7),
                reader.IsDBNull(8) ? null : reader.GetGuid(8),
                reader.GetBoolean(9)));
        }
        return rows;
    }

    public async Task<MeetMediaAssetRow?> GetAssetAsync(Guid assetId, MeetAccessScope scope, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT a.id, a.session_id, a.kind, COALESCE(a.local_path, ''), a.status, a.size_bytes
            FROM meet_media_assets a
            JOIN meet_sessions s ON s.id = a.session_id
            WHERE a.id = @id AND a.status <> 'deleted' AND a.status <> 'purged'
              AND (@all OR s.circle_id = ANY(@circles));
            """, connection);
        command.Parameters.AddWithValue("id", assetId);
        command.Parameters.AddWithValue("all", scope.All);
        command.Parameters.AddWithValue("circles", scope.CircleIds);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        return new MeetMediaAssetRow(
            reader.GetGuid(0),
            reader.GetGuid(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetInt64(5));
    }
}
