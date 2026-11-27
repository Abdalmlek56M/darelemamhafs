using Dar.Modules.Meet.Domain;
using Dar.Modules.Meet.Infrastructure;
using Npgsql;

namespace Dar.Modules.Meet.Persistence;

public sealed record EventUpsertResult(int Added, int Updated, int Cancelled);

/// <summary>Calendar account, sync state and event storage (Dapper-free Npgsql like Teaching).</summary>
public sealed partial class MeetCalendarRepository
{
    private readonly NpgsqlDataSource dataSource;

    public MeetCalendarRepository(NpgsqlDataSource dataSource) => this.dataSource = dataSource;

    private const string AccountColumns = """
        id, provider, account_email, calendar_id, encrypted_refresh_token, token_scope, sync_token,
        last_sync_at, last_full_sync_at, last_error_code, last_error_message, consecutive_failures, status
        """;

    /// <summary>FINAL 1.15: returns false when this OAuth state nonce was already consumed.</summary>
    public async Task<bool> TryConsumeOAuthStateAsync(Guid nonce, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            INSERT INTO meet_oauth_states(nonce, consumed_at) VALUES(@nonce, now())
            ON CONFLICT (nonce) DO NOTHING
            RETURNING nonce;
            """, connection);
        command.Parameters.AddWithValue("nonce", nonce);
        return await command.ExecuteScalarAsync(ct) is not null;
    }

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

}
