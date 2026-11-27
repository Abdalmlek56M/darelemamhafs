using System.Security.Claims;
using System.Text.Json;
using Npgsql;

namespace Dar.Modules.Teaching;

public static class PayrollLock
{
    public const string LockedMessage = "مسير رواتب هذا الشهر مقفل. افتح المسير قبل تعديل الحضور أو الأجر.";

    public static async Task<bool> IsLockedAsync(NpgsqlConnection connection, NpgsqlTransaction? transaction, DateOnly date, CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("SELECT is_locked FROM payroll_locks WHERE billing_month=date_trunc('month',@date::date)::date;", connection, transaction);
        command.Parameters.AddWithValue("date", date);
        return await command.ExecuteScalarAsync(ct) is bool locked && locked;
    }

    /// <summary>
    /// Single guard used by every write path that changes teacher attendance or pay.
    /// Returns the canonical 409 conflict result when the payroll month is locked,
    /// or null when the caller may continue inside its transaction.
    /// </summary>
    public static async Task<IResult?> CheckAsync(NpgsqlConnection connection, NpgsqlTransaction? transaction, DateOnly date, CancellationToken ct)
        => await IsLockedAsync(connection, transaction, date, ct)
            ? Results.Conflict(new { message = LockedMessage })
            : null;
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
        CancellationToken ct,
        Guid? scopeCircleId = null,
        Guid? scopeTeacherId = null)
    {
        await using var command = new NpgsqlCommand("""
            INSERT INTO notifications(user_id, role_scope, category, status, severity, title, body, entity_type, entity_id, action_url, dedupe_key, scope_circle_id, scope_teacher_id)
            VALUES (@user, @role, @category, 'open', @severity, @title, @body, @type, @id, @url, @dedupe, @scopeCircle, @scopeTeacher)
            ON CONFLICT (dedupe_key) DO UPDATE
            SET status='open', resolved_at=NULL, resolved_by=NULL, resolution_note=NULL,
                title=EXCLUDED.title, body=EXCLUDED.body, action_url=EXCLUDED.action_url,
                scope_circle_id=EXCLUDED.scope_circle_id, scope_teacher_id=EXCLUDED.scope_teacher_id;
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
        AddNullable(command, "scopeCircle", scopeCircleId);
        AddNullable(command, "scopeTeacher", scopeTeacherId);
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
