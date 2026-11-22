using Dar.Modules.Meet.Domain;
using Dar.Modules.Meet.Infrastructure;
using Npgsql;

namespace Dar.Modules.Meet.Persistence;

public sealed record EventUpsertResult(int Added, int Updated, int Cancelled);

/// <summary>Calendar account, sync state and event storage (Dapper-free Npgsql like Teaching).</summary>
public sealed class MeetCalendarRepository(NpgsqlDataSource dataSource)
{
    private const string AccountColumns = """
        id, provider, account_email, calendar_id, encrypted_refresh_token, token_scope, sync_token,
        last_sync_at, last_full_sync_at, last_error_code, last_error_message, consecutive_failures, status
        """;

    public async Task<MeetAccount?> GetActiveAccountAsync(CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand($"""
            SELECT {AccountColumns}
            FROM meet_calendar_accounts
            WHERE provider = 'google' AND status <> 'revoked'
            ORDER BY updated_at DESC
            LIMIT 1;
            """, connection);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? MapAccount(reader) : null;
    }

    public async Task<MeetAccount?> GetAccountAsync(Guid accountId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand($"""
            SELECT {AccountColumns}
            FROM meet_calendar_accounts
            WHERE id = @id;
            """, connection);
        command.Parameters.AddWithValue("id", accountId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? MapAccount(reader) : null;
    }

    /// <summary>Stores the freshly obtained refresh token and makes it the only active account.</summary>
    public async Task<Guid> SaveAccountAsync(
        string accountEmail,
        string encryptedRefreshToken,
        string? scope,
        Guid? actor,
        CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await using (var revoke = new NpgsqlCommand("""
            UPDATE meet_calendar_accounts
            SET status = 'revoked', sync_token = NULL, updated_at = now()
            WHERE provider = 'google' AND status <> 'revoked';
            """, connection, transaction))
        {
            await revoke.ExecuteNonQueryAsync(ct);
        }

        Guid accountId;
        await using (var upsert = new NpgsqlCommand("""
            INSERT INTO meet_calendar_accounts(
                provider, account_email, encrypted_refresh_token, token_scope, token_issued_at, connected_by)
            VALUES ('google', @email, @token, @scope, now(), @actor)
            ON CONFLICT (provider, account_email) DO UPDATE
            SET encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
                token_scope = EXCLUDED.token_scope,
                token_issued_at = now(),
                status = 'connected',
                sync_token = NULL,
                last_error_code = NULL,
                last_error_message = NULL,
                consecutive_failures = 0,
                connected_by = EXCLUDED.connected_by,
                updated_at = now()
            RETURNING id;
            """, connection, transaction))
        {
            upsert.Parameters.AddWithValue("email", accountEmail.Trim().ToLowerInvariant());
            upsert.Parameters.AddWithValue("token", encryptedRefreshToken);
            upsert.Parameters.AddWithValue("scope", (object?)scope ?? DBNull.Value);
            upsert.Parameters.AddWithValue("actor", (object?)actor ?? DBNull.Value);
            accountId = (Guid)(await upsert.ExecuteScalarAsync(ct))!;
        }

        await transaction.CommitAsync(ct);
        return accountId;
    }

    public async Task RevokeAccountsAsync(CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            UPDATE meet_calendar_accounts
            SET status = 'revoked', sync_token = NULL, updated_at = now()
            WHERE provider = 'google' AND status <> 'revoked';
            """, connection);
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task SaveSyncSuccessAsync(Guid accountId, string? syncToken, bool fullSync, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            UPDATE meet_calendar_accounts
            SET sync_token = COALESCE(@syncToken, sync_token),
                last_sync_at = now(),
                last_full_sync_at = CASE WHEN @full THEN now() ELSE last_full_sync_at END,
                last_error_code = NULL,
                last_error_message = NULL,
                consecutive_failures = 0,
                updated_at = now()
            WHERE id = @id;
            """, connection);
        command.Parameters.AddWithValue("id", accountId);
        command.Parameters.AddWithValue("syncToken", (object?)syncToken ?? DBNull.Value);
        command.Parameters.AddWithValue("full", fullSync);
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task SaveSyncFailureAsync(
        Guid accountId,
        string errorCode,
        string message,
        bool needsReconnect,
        CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            UPDATE meet_calendar_accounts
            SET last_error_code = @code,
                last_error_message = @message,
                consecutive_failures = consecutive_failures + 1,
                status = CASE WHEN @reconnect THEN 'needs_reconnect' ELSE status END,
                updated_at = now()
            WHERE id = @id;
            """, connection);
        command.Parameters.AddWithValue("id", accountId);
        command.Parameters.AddWithValue("code", errorCode);
        command.Parameters.AddWithValue("message", message.Length <= 1000 ? message : message[..1000]);
        command.Parameters.AddWithValue("reconnect", needsReconnect);
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task<EventUpsertResult> UpsertEventsAsync(
        Guid accountId,
        string calendarId,
        IReadOnlyList<GoogleCalendarEvent> events,
        CancellationToken ct)
    {
        if (events.Count == 0) return new EventUpsertResult(0, 0, 0);

        var added = 0;
        var updated = 0;
        var cancelled = 0;

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await using (var command = new NpgsqlCommand("""
            INSERT INTO meet_events(
                account_id, google_event_id, calendar_id, occurrence_start, occurrence_end, time_zone,
                summary, description, location, meet_link, html_link, organizer_email, google_status,
                is_recurring, raw, synced_at)
            VALUES (
                @account, @googleId, @calendar, @start, @end, @zone,
                @summary, @description, @location, @meetLink, @htmlLink, @organizer, @status,
                @recurring, @raw::jsonb, now())
            ON CONFLICT (account_id, google_event_id, occurrence_start) DO UPDATE
            SET occurrence_end = EXCLUDED.occurrence_end,
                time_zone = EXCLUDED.time_zone,
                summary = EXCLUDED.summary,
                description = EXCLUDED.description,
                location = EXCLUDED.location,
                meet_link = EXCLUDED.meet_link,
                html_link = EXCLUDED.html_link,
                organizer_email = EXCLUDED.organizer_email,
                google_status = EXCLUDED.google_status,
                is_recurring = EXCLUDED.is_recurring,
                raw = EXCLUDED.raw,
                synced_at = now(),
                updated_at = now()
            RETURNING (xmax = 0) AS inserted;
            """, connection, transaction))
        {
            foreach (var item in events)
            {
                command.Parameters.Clear();
                command.Parameters.AddWithValue("account", accountId);
                command.Parameters.AddWithValue("googleId", Truncate(item.Id, 1000)!);
                command.Parameters.AddWithValue("calendar", Truncate(calendarId, 200)!);
                command.Parameters.AddWithValue("start", item.Start.ToUniversalTime());
                command.Parameters.AddWithValue("end", item.End.ToUniversalTime());
                command.Parameters.AddWithValue("zone", (object?)Truncate(item.TimeZone, 80) ?? DBNull.Value);
                command.Parameters.AddWithValue("summary", (object?)Truncate(item.Summary, 500) ?? DBNull.Value);
                command.Parameters.AddWithValue("description", (object?)Truncate(item.Description, 8000) ?? DBNull.Value);
                command.Parameters.AddWithValue("location", (object?)Truncate(item.Location, 500) ?? DBNull.Value);
                command.Parameters.AddWithValue("meetLink", (object?)Truncate(item.MeetLink, 1000) ?? DBNull.Value);
                command.Parameters.AddWithValue("htmlLink", (object?)Truncate(item.HtmlLink, 1000) ?? DBNull.Value);
                command.Parameters.AddWithValue("organizer", (object?)Truncate(item.OrganizerEmail, 320) ?? DBNull.Value);
                command.Parameters.AddWithValue("status", NormalizeStatus(item.Status));
                command.Parameters.AddWithValue("recurring", item.IsRecurring);
                command.Parameters.AddWithValue("raw", item.RawJson);

                var inserted = await command.ExecuteScalarAsync(ct);
                if (inserted is true) added++;
                else updated++;
                if (NormalizeStatus(item.Status) == "cancelled") cancelled++;
            }
        }

        await transaction.CommitAsync(ct);
        return new EventUpsertResult(added, updated, cancelled);
    }

    public async Task<(IReadOnlyList<MeetEventRow> Items, int Total)> ListEventsAsync(
        Guid accountId,
        DateTimeOffset from,
        DateTimeOffset to,
        string filter,
        string? search,
        Guid[]? circleScope,
        int page,
        int pageSize,
        CancellationToken ct)
    {
        var predicate = FilterPredicate(filter);
        var searchTerm = string.IsNullOrWhiteSpace(search) ? null : "%" + search.Trim() + "%";
        var scopePredicate = circleScope is null ? "TRUE" : "l.circle_id = ANY(@circles)";
        var offset = (page - 1) * pageSize;

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var total = await CountAsync(connection, accountId, from, to, predicate, scopePredicate, searchTerm, circleScope, ct);
        var items = new List<MeetEventRow>();

        await using (var command = new NpgsqlCommand($"""
            SELECT e.id, e.google_event_id, e.summary, e.meet_link, e.html_link,
                   e.occurrence_start, e.occurrence_end, e.time_zone, e.google_status, e.is_recurring,
                   e.recording_mode, l.circle_id, c.name, COALESCE(l.auto_matched, FALSE),
                   COALESCE(cs.auto_record, FALSE)
            FROM meet_events e
            LEFT JOIN meet_event_links l ON l.event_id = e.id
            LEFT JOIN circles c ON c.id = l.circle_id
            LEFT JOIN meet_circle_settings cs ON cs.circle_id = l.circle_id
            WHERE e.account_id = @account
              AND e.occurrence_start >= @from
              AND e.occurrence_start < @to
              AND ({predicate})
              AND ({scopePredicate})
              AND (@search IS NULL OR e.summary ILIKE @search)
            ORDER BY e.occurrence_start
            LIMIT @take OFFSET @skip;
            """, connection))
        {
            AddListParameters(command, accountId, from, to, searchTerm, circleScope);
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
                   COALESCE(cs.auto_record, FALSE)
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
              AND (@search IS NULL OR e.summary ILIKE @search);
            """, connection);
        AddListParameters(command, accountId, from, to, searchTerm, circleScope);
        return Convert.ToInt32(await command.ExecuteScalarAsync(ct) ?? 0);
    }

    private static void AddListParameters(
        NpgsqlCommand command,
        Guid accountId,
        DateTimeOffset from,
        DateTimeOffset to,
        string? searchTerm,
        Guid[]? circleScope)
    {
        command.Parameters.AddWithValue("account", accountId);
        command.Parameters.AddWithValue("from", from.ToUniversalTime());
        command.Parameters.AddWithValue("to", to.ToUniversalTime());
        // Npgsql cannot infer a type for a NULL parameter used in "@search IS NULL"; an
        // untyped NULL makes PostgreSQL reject the whole statement with 42P08.
        command.Parameters.AddWithValue("search", NpgsqlTypes.NpgsqlDbType.Text, (object?)searchTerm ?? DBNull.Value);
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
        CircleAutoRecord = reader.GetBoolean(14)
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
