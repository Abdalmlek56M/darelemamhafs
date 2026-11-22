using Dar.Modules.Meet.Domain;
using Npgsql;

namespace Dar.Modules.Meet.Persistence;

/// <summary>Event/circle links, the owner's recording scope and module settings.</summary>
public sealed class MeetScopeRepository(NpgsqlDataSource dataSource)
{
    public async Task<IReadOnlyList<(Guid Id, string Name)>> ListCircleNamesAsync(
        Guid[]? circleScope,
        CancellationToken ct)
    {
        var circles = new List<(Guid, string)>();
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT id, name FROM circles
            WHERE is_trashed = FALSE
              AND (@scoped = FALSE OR id = ANY(@circles))
            ORDER BY name
            LIMIT 500;
            """, connection);
        command.Parameters.AddWithValue("scoped", circleScope is not null);
        command.Parameters.AddWithValue("circles", circleScope ?? []);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) circles.Add((reader.GetGuid(0), reader.GetString(1)));
        return circles;
    }

    public async Task<IReadOnlyList<MeetCircleRow>> ListCircleSettingsAsync(
        Guid[]? circleScope,
        CancellationToken ct)
    {
        var rows = new List<MeetCircleRow>();
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT c.id, c.name, c.is_active,
                   COALESCE(s.auto_record, FALSE) AS auto_record,
                   COALESCE(s.auto_link, TRUE) AS auto_link,
                   COALESCE(upcoming.total, 0) AS upcoming_linked
            FROM circles c
            LEFT JOIN meet_circle_settings s ON s.circle_id = c.id
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS total
                FROM meet_event_links l
                JOIN meet_events e ON e.id = l.event_id
                WHERE l.circle_id = c.id
                  AND e.occurrence_start >= now()
                  AND e.google_status <> 'cancelled'
            ) upcoming ON TRUE
            WHERE c.is_trashed = FALSE
              AND (@scoped = FALSE OR c.id = ANY(@circles))
            ORDER BY c.name
            LIMIT 500;
            """, connection);
        command.Parameters.AddWithValue("scoped", circleScope is not null);
        command.Parameters.AddWithValue("circles", circleScope ?? []);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            rows.Add(new MeetCircleRow
            {
                CircleId = reader.GetGuid(0),
                Name = reader.GetString(1),
                IsActive = reader.GetBoolean(2),
                AutoRecord = reader.GetBoolean(3),
                AutoLink = reader.GetBoolean(4),
                UpcomingLinkedEvents = (int)reader.GetInt64(5)
            });
        }

        return rows;
    }

    public async Task<bool> CircleExistsAsync(Guid circleId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT EXISTS(SELECT 1 FROM circles WHERE id = @id AND is_trashed = FALSE);
            """, connection);
        command.Parameters.AddWithValue("id", circleId);
        return await command.ExecuteScalarAsync(ct) is true;
    }

    public async Task SaveCircleSettingsAsync(
        Guid circleId,
        bool autoRecord,
        bool autoLink,
        Guid actor,
        CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            INSERT INTO meet_circle_settings(circle_id, auto_record, auto_link, updated_by)
            VALUES (@circle, @record, @link, @actor)
            ON CONFLICT (circle_id) DO UPDATE
            SET auto_record = EXCLUDED.auto_record,
                auto_link = EXCLUDED.auto_link,
                updated_by = EXCLUDED.updated_by,
                updated_at = now();
            """, connection);
        command.Parameters.AddWithValue("circle", circleId);
        command.Parameters.AddWithValue("record", autoRecord);
        command.Parameters.AddWithValue("link", autoLink);
        command.Parameters.AddWithValue("actor", actor);
        await command.ExecuteNonQueryAsync(ct);
    }

    /// <summary>Enables recording for one circle without touching its auto-link preference.</summary>
    public async Task SetCircleAutoRecordAsync(Guid circleId, bool autoRecord, Guid actor, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            INSERT INTO meet_circle_settings(circle_id, auto_record, auto_link, updated_by)
            VALUES (@circle, @record, TRUE, @actor)
            ON CONFLICT (circle_id) DO UPDATE
            SET auto_record = EXCLUDED.auto_record,
                updated_by = EXCLUDED.updated_by,
                updated_at = now();
            """, connection);
        command.Parameters.AddWithValue("circle", circleId);
        command.Parameters.AddWithValue("record", autoRecord);
        command.Parameters.AddWithValue("actor", actor);
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task<bool> LinkAsync(
        Guid eventId,
        Guid circleId,
        bool autoMatched,
        Guid? actor,
        CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            INSERT INTO meet_event_links(event_id, circle_id, auto_matched, linked_by)
            VALUES (@event, @circle, @auto, @actor)
            ON CONFLICT (event_id) DO UPDATE
            SET circle_id = EXCLUDED.circle_id,
                auto_matched = EXCLUDED.auto_matched,
                linked_by = EXCLUDED.linked_by,
                updated_at = now();
            """, connection);
        command.Parameters.AddWithValue("event", eventId);
        command.Parameters.AddWithValue("circle", circleId);
        command.Parameters.AddWithValue("auto", autoMatched);
        command.Parameters.AddWithValue("actor", (object?)actor ?? DBNull.Value);
        return await command.ExecuteNonQueryAsync(ct) > 0;
    }

    public async Task<bool> LinkIfUnlinkedAsync(Guid eventId, Guid circleId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            INSERT INTO meet_event_links(event_id, circle_id, auto_matched)
            SELECT @event, @circle, TRUE
            WHERE NOT EXISTS (SELECT 1 FROM meet_event_links WHERE event_id = @event)
            ON CONFLICT (event_id) DO NOTHING;
            """, connection);
        command.Parameters.AddWithValue("event", eventId);
        command.Parameters.AddWithValue("circle", circleId);
        return await command.ExecuteNonQueryAsync(ct) > 0;
    }

    public async Task<bool> UnlinkAsync(Guid eventId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand(
            "DELETE FROM meet_event_links WHERE event_id = @event;", connection);
        command.Parameters.AddWithValue("event", eventId);
        return await command.ExecuteNonQueryAsync(ct) > 0;
    }

    public async Task<bool> SetRecordingModeAsync(Guid eventId, string mode, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            UPDATE meet_events
            SET recording_mode = @mode, updated_at = now()
            WHERE id = @event
            RETURNING id;
            """, connection);
        command.Parameters.AddWithValue("event", eventId);
        command.Parameters.AddWithValue("mode", mode);
        return await command.ExecuteScalarAsync(ct) is Guid;
    }

    public async Task<MeetSettingsRow?> GetSettingsAsync(CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT recording_enabled, join_lead_seconds, stop_grace_seconds,
                   max_concurrent_sessions, disk_block_gb, disk_warn_gb,
                   upload_bwlimit, hls_retention_hours
            FROM meet_settings WHERE id = TRUE;
            """, connection);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        return new MeetSettingsRow
        {
            RecordingEnabled = reader.GetBoolean(0),
            JoinLeadSeconds = reader.GetInt32(1),
            StopGraceSeconds = reader.GetInt32(2),
            MaxConcurrentSessions = reader.GetInt16(3),
            DiskBlockGb = reader.GetInt32(4),
            DiskWarnGb = reader.GetInt32(5),
            UploadBwLimit = reader.GetString(6),
            HlsRetentionHours = reader.GetInt32(7)
        };
    }
}
