using System.Security.Claims;
using System.Text.Json;
using Npgsql;

namespace Dar.Modules.Teaching;

public static class CairoTime
{
    private static readonly TimeZoneInfo Zone = ResolveZone();

    private static TimeZoneInfo ResolveZone()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("Africa/Cairo"); }
        catch (TimeZoneNotFoundException) { return TimeZoneInfo.FindSystemTimeZoneById("Egypt Standard Time"); }
    }

    public static DateTimeOffset Now() => TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, Zone);
    public static DateOnly Today() => DateOnly.FromDateTime(Now().DateTime);
    public static TimeOnly NowTime() => TimeOnly.FromDateTime(Now().DateTime);
    public static TimeOnly ToLocalTime(DateTimeOffset value) => TimeOnly.FromDateTime(TimeZoneInfo.ConvertTime(value, Zone).DateTime);
}

public static class TeachingPrincipal
{
    public static Guid UserId(ClaimsPrincipal principal) =>
        Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : Guid.Empty;

    public static Guid TeacherId(ClaimsPrincipal principal) =>
        Guid.TryParse(principal.FindFirstValue("teacher_id"), out var id) ? id : Guid.Empty;

    public static bool Has(ClaimsPrincipal principal, string permission) =>
        principal.HasClaim("permission", permission);
}

public static class TeachingAudit
{
    public static async Task WriteAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        ClaimsPrincipal principal,
        string actionCode,
        string entityType,
        Guid entityId,
        object details,
        string path,
        string method,
        CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("""
            INSERT INTO audit_log(actor_user_id, actor_display_name, action_code, entity_type, entity_id, details, request_path, http_method, can_restore)
            VALUES (@actor, @name, @action, @type, @id, @details::jsonb, @path, @method, FALSE);
            """, connection, transaction);
        command.Parameters.AddWithValue("actor", TeachingPrincipal.UserId(principal));
        command.Parameters.AddWithValue("name", principal.FindFirstValue("display_name") ?? "مستخدم");
        command.Parameters.AddWithValue("action", actionCode);
        command.Parameters.AddWithValue("type", entityType);
        command.Parameters.AddWithValue("id", entityId);
        command.Parameters.AddWithValue("details", JsonSerializer.Serialize(details));
        command.Parameters.AddWithValue("path", path);
        command.Parameters.AddWithValue("method", method);
        await command.ExecuteNonQueryAsync(ct);
    }
}

public sealed record TeachingSessionRow(
    Guid Id,
    Guid TeacherId,
    Guid CircleId,
    Guid ScheduleSlotId,
    DateOnly SessionDate,
    DateTimeOffset StartedAt,
    DateTimeOffset? EndedAt,
    string Status,
    int ScheduledDurationMinutes,
    int? ActualDurationMinutes,
    int? PayableDurationMinutes,
    string? PayBasis,
    int OvertimeMinutes,
    int UndertimeMinutes,
    string? Note,
    string CircleName,
    TimeOnly StartsAt,
    decimal HourlyRate);

public static class TeachingSessionLookup
{
    public static async Task<TeachingSessionRow?> FindAsync(
        NpgsqlDataSource dataSource,
        Guid sessionId,
        Guid teacherId,
        CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT ts.id, ts.teacher_id, ts.circle_id, ts.schedule_slot_id, ts.session_date,
                   ts.started_at, ts.ended_at, ts.status, ts.scheduled_duration_minutes,
                   ts.actual_duration_minutes, ts.payable_duration_minutes, ts.pay_basis,
                   ts.overtime_minutes, ts.undertime_minutes, ts.note,
                   c.name, ss.starts_at, t.hourly_rate
            FROM teacher_sessions ts
            JOIN circles c ON c.id = ts.circle_id
            JOIN circle_schedule_slots ss ON ss.id = ts.schedule_slot_id
            JOIN teachers t ON t.id = ts.teacher_id
            WHERE ts.id = @id AND ts.teacher_id = @teacher AND t.is_trashed = FALSE;
            """, connection);
        command.Parameters.AddWithValue("id", sessionId);
        command.Parameters.AddWithValue("teacher", teacherId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return new TeachingSessionRow(
            reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetGuid(3),
            reader.GetFieldValue<DateOnly>(4), reader.GetFieldValue<DateTimeOffset>(5),
            reader.IsDBNull(6) ? null : reader.GetFieldValue<DateTimeOffset>(6), reader.GetString(7),
            reader.GetInt32(8), reader.IsDBNull(9) ? null : reader.GetInt32(9),
            reader.IsDBNull(10) ? null : reader.GetInt32(10), reader.IsDBNull(11) ? null : reader.GetString(11),
            reader.GetInt32(12), reader.GetInt32(13), reader.IsDBNull(14) ? null : reader.GetString(14),
            reader.GetString(15), reader.GetFieldValue<TimeOnly>(16), reader.GetDecimal(17));
    }
}

public static class TeachingNotifications
{
    public static async Task OpenAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid? userId,
        string? roleScope,
        string category,
        string severity,
        string title,
        string body,
        string entityType,
        Guid entityId,
        string actionUrl,
        string dedupeKey,
        CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("""
            INSERT INTO notifications(user_id, role_scope, category, status, severity, title, body, entity_type, entity_id, action_url, dedupe_key)
            VALUES (@user, @role, @category, 'open', @severity, @title, @body, @type, @id, @url, @dedupe)
            ON CONFLICT (dedupe_key) DO UPDATE
            SET status='open', resolved_at=NULL, resolved_by=NULL, resolution_note=NULL,
                title=EXCLUDED.title, body=EXCLUDED.body, action_url=EXCLUDED.action_url;
            """, connection, transaction);
        AddNullable(command, "user", userId);
        AddNullable(command, "role", roleScope);
        command.Parameters.AddWithValue("category", category);
        command.Parameters.AddWithValue("severity", severity);
        command.Parameters.AddWithValue("title", title);
        command.Parameters.AddWithValue("body", body);
        command.Parameters.AddWithValue("type", entityType);
        command.Parameters.AddWithValue("id", entityId);
        command.Parameters.AddWithValue("url", actionUrl);
        command.Parameters.AddWithValue("dedupe", dedupeKey);
        await command.ExecuteNonQueryAsync(ct);
    }

    public static async Task ResolveAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string dedupeKey,
        Guid actor,
        string note,
        CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("""
            UPDATE notifications
            SET status='resolved', resolved_at=now(), resolved_by=@actor, resolution_note=@note
            WHERE dedupe_key=@dedupe AND status='open';
            """, connection, transaction);
        command.Parameters.AddWithValue("dedupe", dedupeKey);
        command.Parameters.AddWithValue("actor", actor);
        command.Parameters.AddWithValue("note", note);
        await command.ExecuteNonQueryAsync(ct);
    }

    public static void AddNullable(NpgsqlCommand command, string name, object? value) =>
        command.Parameters.AddWithValue(name, value ?? DBNull.Value);
}
