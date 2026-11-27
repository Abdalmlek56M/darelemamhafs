using Dar.Modules.Meet.Domain;
using Npgsql;

namespace Dar.Modules.Meet.Persistence;

public sealed partial class MeetCalendarRepository
{
    public async Task<(IReadOnlyList<MeetEventRow> Items, int Total)> ListEventsAsync(
        Guid accountId,
        DateTimeOffset from,
        DateTimeOffset to,
        string filter,
        string? search,
        Guid[]? circleScope,
        bool meetOnly,
        int page,
        int pageSize,
        CancellationToken ct)
    {
        var predicate = FilterPredicate(filter);
        var searchTerm = string.IsNullOrWhiteSpace(search) ? null : "%" + search.Trim() + "%";
        var scopePredicate = circleScope is null ? "TRUE" : "l.circle_id = ANY(@circles)";
        var offset = (page - 1) * pageSize;

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var total = await CountAsync(connection, accountId, from, to, predicate, scopePredicate, searchTerm, circleScope, meetOnly, ct);
        var items = new List<MeetEventRow>();

        await using (var command = new NpgsqlCommand($"""
            SELECT e.id, e.google_event_id, e.summary, e.meet_link, e.html_link,
                   e.occurrence_start, e.occurrence_end, e.time_zone, e.google_status, e.is_recurring,
                   e.recording_mode, l.circle_id, c.name, COALESCE(l.auto_matched, FALSE),
                   COALESCE(cs.auto_record, FALSE), e.access_type
            FROM meet_events e
            LEFT JOIN meet_event_links l ON l.event_id = e.id
            LEFT JOIN circles c ON c.id = l.circle_id
            LEFT JOIN meet_circle_settings cs ON cs.circle_id = l.circle_id
            WHERE e.account_id = @account
              AND e.occurrence_start >= @from
              AND e.occurrence_start < @to
              AND ({predicate})
              AND ({scopePredicate})
              AND (@meetOnly = FALSE OR e.meet_link IS NOT NULL)
              AND (@search IS NULL OR e.summary ILIKE @search)
            ORDER BY e.occurrence_start
            LIMIT @take OFFSET @skip;
            """, connection))
        {
            AddListParameters(command, accountId, from, to, searchTerm, circleScope, meetOnly);
            command.Parameters.AddWithValue("take", pageSize);
            command.Parameters.AddWithValue("skip", offset);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) items.Add(MapEvent(reader));
        }

        return (items, total);
    }

    public async Task<Guid?> FindEventIdAsync(
        Guid accountId,
        string googleEventId,
        DateTimeOffset occurrenceStart,
        CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT id FROM meet_events
            WHERE account_id = @account AND google_event_id = @googleId AND occurrence_start = @start
            LIMIT 1;
            """, connection);
        command.Parameters.AddWithValue("account", accountId);
        command.Parameters.AddWithValue("googleId", googleEventId);
        command.Parameters.AddWithValue("start", occurrenceStart.ToUniversalTime());
        return await command.ExecuteScalarAsync(ct) as Guid?;
    }

    public async Task<MeetEventRow?> GetEventAsync(Guid accountId, Guid eventId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT e.id, e.google_event_id, e.summary, e.meet_link, e.html_link,
                   e.occurrence_start, e.occurrence_end, e.time_zone, e.google_status, e.is_recurring,
                   e.recording_mode, l.circle_id, c.name, COALESCE(l.auto_matched, FALSE),
                   COALESCE(cs.auto_record, FALSE), e.access_type
            FROM meet_events e
            LEFT JOIN meet_event_links l ON l.event_id = e.id
            LEFT JOIN circles c ON c.id = l.circle_id
            LEFT JOIN meet_circle_settings cs ON cs.circle_id = l.circle_id
            WHERE e.account_id = @account AND e.id = @id;
            """, connection);
        command.Parameters.AddWithValue("account", accountId);
        command.Parameters.AddWithValue("id", eventId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? MapEvent(reader) : null;
    }

    private static async Task<int> CountAsync(
        NpgsqlConnection connection,
        Guid accountId,
        DateTimeOffset from,
        DateTimeOffset to,
        string predicate,
        string scopePredicate,
        string? searchTerm,
        Guid[]? circleScope,
        bool meetOnly,
        CancellationToken ct)
    {
        await using var command = new NpgsqlCommand($"""
            SELECT COUNT(*)
            FROM meet_events e
            LEFT JOIN meet_event_links l ON l.event_id = e.id
            LEFT JOIN meet_circle_settings cs ON cs.circle_id = l.circle_id
            WHERE e.account_id = @account
              AND e.occurrence_start >= @from
              AND e.occurrence_start < @to
              AND ({predicate})
              AND ({scopePredicate})
              AND (@meetOnly = FALSE OR e.meet_link IS NOT NULL)
              AND (@search IS NULL OR e.summary ILIKE @search);
            """, connection);
        AddListParameters(command, accountId, from, to, searchTerm, circleScope, meetOnly);
        return Convert.ToInt32(await command.ExecuteScalarAsync(ct) ?? 0);
    }

    private static void AddListParameters(
        NpgsqlCommand command,
        Guid accountId,
        DateTimeOffset from,
        DateTimeOffset to,
        string? searchTerm,
        Guid[]? circleScope,
        bool meetOnly)
    {
        command.Parameters.AddWithValue("account", accountId);
        command.Parameters.AddWithValue("from", from.ToUniversalTime());
        command.Parameters.AddWithValue("to", to.ToUniversalTime());
        // Npgsql cannot infer a type for a NULL parameter used in "@search IS NULL"; an
        // untyped NULL makes PostgreSQL reject the whole statement with 42P08.
        command.Parameters.AddWithValue("search", NpgsqlTypes.NpgsqlDbType.Text, (object?)searchTerm ?? DBNull.Value);
        command.Parameters.AddWithValue("meetOnly", meetOnly);
        if (circleScope is not null) command.Parameters.AddWithValue("circles", circleScope);
    }

    private static string FilterPredicate(string filter) => filter switch
    {
        "linked" => "l.circle_id IS NOT NULL",
        "unlinked" => "l.circle_id IS NULL",
        "recording" => "(e.recording_mode = 'force' OR (e.recording_mode = 'inherit' AND l.circle_id IS NOT NULL AND COALESCE(cs.auto_record, FALSE))) AND e.google_status <> 'cancelled'",
        "cancelled" => "e.google_status = 'cancelled'",
        _ => "TRUE"
    };

    private static MeetEventRow MapEvent(NpgsqlDataReader reader) => new()
    {
        Id = reader.GetGuid(0),
        GoogleEventId = reader.GetString(1),
        Summary = reader.IsDBNull(2) ? null : reader.GetString(2),
        MeetLink = reader.IsDBNull(3) ? null : reader.GetString(3),
        HtmlLink = reader.IsDBNull(4) ? null : reader.GetString(4),
        OccurrenceStart = reader.GetFieldValue<DateTimeOffset>(5),
        OccurrenceEnd = reader.GetFieldValue<DateTimeOffset>(6),
        TimeZone = reader.IsDBNull(7) ? null : reader.GetString(7),
        GoogleStatus = reader.GetString(8),
        IsRecurring = reader.GetBoolean(9),
        RecordingMode = reader.GetString(10),
        LinkedCircleId = reader.IsDBNull(11) ? null : reader.GetGuid(11),
        LinkedCircleName = reader.IsDBNull(12) ? null : reader.GetString(12),
        LinkedAutomatically = reader.GetBoolean(13),
        CircleAutoRecord = reader.GetBoolean(14),
        AccessType = reader.IsDBNull(15) ? null : reader.GetString(15)
    };

    private static MeetAccount MapAccount(NpgsqlDataReader reader) => new()
    {
        Id = reader.GetGuid(0),
        Provider = reader.GetString(1),
        AccountEmail = reader.GetString(2),
        CalendarId = reader.GetString(3),
        EncryptedRefreshToken = reader.GetString(4),
        TokenScope = reader.IsDBNull(5) ? null : reader.GetString(5),
        SyncToken = reader.IsDBNull(6) ? null : reader.GetString(6),
        LastSyncAt = reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7),
        LastFullSyncAt = reader.IsDBNull(8) ? null : reader.GetFieldValue<DateTimeOffset>(8),
        LastErrorCode = reader.IsDBNull(9) ? null : reader.GetString(9),
        LastErrorMessage = reader.IsDBNull(10) ? null : reader.GetString(10),
        ConsecutiveFailures = reader.GetInt32(11),
        Status = reader.GetString(12)
    };

    private static string NormalizeStatus(string? status) => status switch
    {
        "cancelled" => "cancelled",
        "tentative" => "tentative",
        _ => "confirmed"
    };

    private static string? Truncate(string? value, int max) =>
        string.IsNullOrEmpty(value) ? value : value.Length <= max ? value : value[..max];
}
