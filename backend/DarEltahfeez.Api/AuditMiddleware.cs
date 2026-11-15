using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using DarEltahfeez.Api.Services;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

/// <summary>Captures successful write requests with actor, route, timestamp and row snapshots where supported.</summary>
public sealed class AuditMiddleware(RequestDelegate next, ILogger<AuditMiddleware> logger)
{
    private sealed record Target(string Table, Guid? Id);

    public async Task InvokeAsync(HttpContext context, NpgsqlDataSource db)
    {
        var method = context.Request.Method.ToUpperInvariant();
        // The legacy domain DELETE endpoints physically removed records. All business records must first
        // pass through the permission-protected Trash API; the only other DELETE route deactivates accounts.
        if (method == "DELETE" && context.Request.Path.StartsWithSegments("/api") &&
            !context.Request.Path.StartsWithSegments("/api/admin/trash") &&
            !context.Request.Path.StartsWithSegments("/api/admin/users"))
        {
            context.Response.StatusCode = StatusCodes.Status409Conflict;
            await context.Response.WriteAsJsonAsync(new { message = "الحذف المباشر معطّل لحماية السجلات. انقل السجل إلى سلة المهملات من لوحة الإدارة أولًا." }, context.RequestAborted);
            return;
        }
        if (!context.Request.Path.StartsWithSegments("/api") || method is not ("POST" or "PUT" or "PATCH" or "DELETE") ||
            context.Request.Path.StartsWithSegments("/api/auth") || context.Request.Path.StartsWithSegments("/api/setup") ||
            context.Request.Path.StartsWithSegments("/api/admin/backups") || context.Request.Path.StartsWithSegments("/api/admin/trash") ||
            context.Request.Path.StartsWithSegments("/api/admin/audit-log"))
        {
            await next(context); return;
        }

        var path = context.Request.Path.Value ?? "/api";
        var body = await ReadJsonBodyAsync(context.Request, context.RequestAborted);
        var target = ResolveTarget(path, body);
        target = await ResolveNaturalKeyTargetAsync(db, path, method, body, target, context.RequestAborted);
        var startedAt = DateTimeOffset.UtcNow;
        string? before = null;
        if (target?.Id is Guid targetId)
        {
            try { before = await SystemAdminEndpoints.ReadSnapshotAsync(db, target.Table, targetId, context.RequestAborted); }
            catch (Exception ex) { logger.LogDebug(ex, "Could not capture pre-change snapshot for {Path}", path); }
        }

        var originalBody = context.Response.Body;
        await using var captured = new MemoryStream();
        context.Response.Body = captured;
        try { await next(context); }
        catch { context.Response.Body = originalBody; throw; }
        finally { context.Response.Body = originalBody; }

        string responseText = "";
        if (captured.Length <= 1_000_000)
        {
            captured.Position = 0;
            using var reader = new StreamReader(captured, leaveOpen: true);
            responseText = await reader.ReadToEndAsync(context.RequestAborted);
        }
        captured.Position = 0;
        await captured.CopyToAsync(originalBody, context.RequestAborted);
        if (context.Response.StatusCode < 200 || context.Response.StatusCode >= 300) return;

        try
        {
            target ??= ResolveTarget(path, body);
            if (target is null) return;
            var id = target.Id ?? TryReadGuid(responseText, "id");
            string? after = null;
            if (id is Guid savedId)
            {
                try { after = await SystemAdminEndpoints.ReadSnapshotAsync(db, target.Table, savedId, context.RequestAborted); }
                catch (Exception ex) { logger.LogDebug(ex, "Could not capture post-change snapshot for {Path}", path); }
            }

            var principal = context.User;
            var actorId = SystemAdminEndpoints.ActorId(principal);
            var actorName = principal.FindFirst(ClaimTypes.Name)?.Value;
            var displayName = principal.FindFirst("display_name")?.Value ?? actorName ?? "حساب غير معروف";
            var canRestore = before is not null && after is not null && (method == "PUT" || method == "PATCH") && SystemAdminService.RestoreColumns.ContainsKey(target.Table);
            var detailJson = JsonSerializer.Serialize(new
            {
                path, method, statusCode = context.Response.StatusCode,
                request = body is null ? null : SafeRequestPayload(body),
                note = before is null ? "لا توجد لقطة سابقة لهذا النوع من العمليات." : null
            });

            await using var cmd = db.CreateCommand("""
                WITH candidate AS (
                  SELECT id FROM audit_log
                  WHERE @entityId IS NOT NULL
                    AND entity_id = @entityId
                    AND entity_type = ANY(@entityTypes)
                    AND actor_user_id IS NOT DISTINCT FROM @actor
                    AND request_path IS NULL AND http_method IS NULL
                    AND occurred_at >= @started - interval '1 second'
                    AND occurred_at <= now()
                    AND before_data IS NULL AND after_data IS NULL
                  ORDER BY occurred_at DESC,id DESC LIMIT 1
                )
                UPDATE audit_log SET actor_display_name=@actorName,request_path=@path,http_method=@method,
                  before_data=COALESCE(before_data,@before::jsonb),after_data=COALESCE(@after::jsonb,after_data),
                  can_restore=@canRestore,details=COALESCE(details,'{}'::jsonb)||@details::jsonb
                WHERE id IN (SELECT id FROM candidate) RETURNING id;
                """);
            cmd.Parameters.AddWithValue("entityId", DbGuid(id));
            cmd.Parameters.Add("entityTypes", NpgsqlDbType.Array | NpgsqlDbType.Text).Value = AuditEntityTypes(target.Table);
            cmd.Parameters.AddWithValue("actor", DbGuid(actorId));
            cmd.Parameters.AddWithValue("actorName", displayName); cmd.Parameters.AddWithValue("path", path); cmd.Parameters.AddWithValue("method", method);
            cmd.Parameters.AddWithValue("started", startedAt); cmd.Parameters.AddWithValue("before", (object?)before ?? DBNull.Value);
            cmd.Parameters.AddWithValue("after", (object?)after ?? DBNull.Value); cmd.Parameters.AddWithValue("canRestore", canRestore);
            cmd.Parameters.AddWithValue("details", NpgsqlDbType.Jsonb, detailJson);
            var updatedId = await cmd.ExecuteScalarAsync(context.RequestAborted);
            if (updatedId is null)
            {
                var action = $"api.{method.ToLowerInvariant()}";
                await using var insert = db.CreateCommand("INSERT INTO audit_log(actor_user_id,actor_display_name,action_code,entity_type,entity_id,details,before_data,after_data,request_path,http_method,can_restore) VALUES(@actor,@actorName,@action,@entityType,@entityId,@details::jsonb,@before::jsonb,@after::jsonb,@path,@method,@canRestore);");
                insert.Parameters.AddWithValue("actor", DbGuid(actorId)); insert.Parameters.AddWithValue("actorName", displayName);
                insert.Parameters.AddWithValue("action", action); insert.Parameters.AddWithValue("entityType", target.Table);
                insert.Parameters.AddWithValue("entityId", DbGuid(id)); insert.Parameters.AddWithValue("details", NpgsqlDbType.Jsonb, detailJson);
                insert.Parameters.AddWithValue("before", (object?)before ?? DBNull.Value); insert.Parameters.AddWithValue("after", (object?)after ?? DBNull.Value);
                insert.Parameters.AddWithValue("path", path); insert.Parameters.AddWithValue("method", method); insert.Parameters.AddWithValue("canRestore", canRestore);
                await insert.ExecuteNonQueryAsync(context.RequestAborted);
            }
        }
        catch (Exception ex)
        {
            // Audit failure is reported loudly but must not turn a business operation that already committed into a false failure.
            logger.LogError(ex, "The operation succeeded but its detailed audit record could not be written for {Path}", path);
        }
    }

    private static object DbGuid(Guid? value) => value is Guid guid ? guid : DBNull.Value;

    // Explicit domain endpoints historically use singular or hyphenated entity labels, while the
    // generic middleware resolves physical PostgreSQL table names. Match only known aliases so a
    // nearby event for another entity cannot inherit this request's snapshots.
    private static string[] AuditEntityTypes(string table) => table switch
    {
        "students" => ["student", "students"],
        "student_notes" => ["student-note", "student_note", "student_notes"],
        "teachers" => ["teacher", "teachers"],
        "circles" => ["circle", "circles"],
        "circle_enrollments" => ["enrollment", "circle-enrollment", "circle_enrollment", "circle_enrollments"],
        "circle_schedule_slots" => ["circle_schedule_slot", "schedule-slot", "schedule_slot", "circle_schedule_slots"],
        "teacher_attendance" => ["teacher-attendance", "teacher_attendance"],
        "advertising_expenses" => ["advertising_expense", "advertising-expense", "advertising_expenses"],
        "operating_expenses" => ["operating_expense", "operating-expense", "operating_expenses"],
        "monthly_charges" => ["monthly_charge", "monthly-charge", "charge", "monthly_charges"],
        "payments" => ["payment", "payments"],
        "collection_reports" => ["collection_report", "collection-report", "collection_reports"],
        "app_users" => ["app_user", "app-user", "user", "app_users"],
        _ => [table]
    };

    private static async Task<string?> ReadJsonBodyAsync(HttpRequest request, CancellationToken ct)
    {
        if (request.ContentLength is > 65536 || request.ContentType?.Contains("application/json", StringComparison.OrdinalIgnoreCase) != true) return null;
        request.EnableBuffering(); request.Body.Position = 0;
        using var reader = new StreamReader(request.Body, leaveOpen: true);
        var body = await reader.ReadToEndAsync(ct); request.Body.Position = 0;
        return string.IsNullOrWhiteSpace(body) ? null : body;
    }

    private static async Task<Target?> ResolveNaturalKeyTargetAsync(
        NpgsqlDataSource db,
        string path,
        string method,
        string? body,
        Target? target,
        CancellationToken ct)
    {
        // Teacher attendance is upserted by (schedule_slot_id, session_date), not by a route ID.
        // Resolve the existing row before the request so the generic audit can capture its before snapshot.
        if (method != "POST" ||
            !path.Equals("/api/teacher-attendance", StringComparison.OrdinalIgnoreCase) ||
            target is not { Table: "teacher_attendance", Id: null } ||
            string.IsNullOrWhiteSpace(body))
            return target;

        try
        {
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            if (!root.TryGetProperty("scheduleSlotId", out var slotValue) ||
                slotValue.ValueKind != JsonValueKind.String || !Guid.TryParse(slotValue.GetString(), out var slotId) ||
                !root.TryGetProperty("sessionDate", out var dateValue) ||
                dateValue.ValueKind != JsonValueKind.String ||
                !DateOnly.TryParse(dateValue.GetString(), System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var sessionDate))
                return target;

            await using var cmd = db.CreateCommand("SELECT id FROM teacher_attendance WHERE schedule_slot_id=@slot AND session_date=@date;");
            cmd.Parameters.AddWithValue("slot", slotId);
            cmd.Parameters.AddWithValue("date", sessionDate);
            var value = await cmd.ExecuteScalarAsync(ct);
            return value is Guid existingId ? target with { Id = existingId } : target;
        }
        catch (JsonException)
        {
            return target;
        }
    }

    private static string? SafeRequestPayload(string body)
    {
        try
        {
            var node = JsonNode.Parse(body);
            if (node is JsonObject obj)
            {
                obj.Remove("password"); obj.Remove("confirmPassword"); obj.Remove("passwordHash"); obj.Remove("password_hash"); obj.Remove("dataUrl"); obj.Remove("logoDataUrl"); obj.Remove("receiptDataUrl"); obj.Remove("avatarDataUrl");
            }
            return node?.ToJsonString();
        }
        catch { return "[تعذر قراءة محتوى الطلب كـ JSON]"; }
    }

    private static Guid? TryReadGuid(string text, string property)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        try { using var document = JsonDocument.Parse(text); return document.RootElement.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String && Guid.TryParse(value.GetString(), out var id) ? id : null; }
        catch (JsonException) { return null; }
    }

    private static Target? ResolveTarget(string path, string? body)
    {
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        string? table = null; Guid? id = null;
        if (parts.Length >= 2)
        {
            // A note collection route has the student's ID, not the newly created note's ID.
            // Do not mistake that parent ID for a student_notes row ID during audit capture.
            var isStudentNotesRoute = parts[1].Equals("students", StringComparison.OrdinalIgnoreCase) &&
                parts.Length >= 4 && Guid.TryParse(parts[2], out _) &&
                parts[3].Equals("notes", StringComparison.OrdinalIgnoreCase);
            if (isStudentNotesRoute)
            {
                table = "student_notes";
                if (parts.Length >= 5 && Guid.TryParse(parts[4], out var noteId)) id = noteId;
            }
            else
            {
                table = parts[1].ToLowerInvariant() switch
                {
                    "students" => "students", "teachers" => "teachers", "circles" => "circles", "enrollments" => "circle_enrollments",
                    "schedule-slots" => "circle_schedule_slots", "teacher-attendance" => "teacher_attendance", "advertising-expenses" => "advertising_expenses",
                    "operating-expenses" => "operating_expenses", "charges" => "monthly_charges", "payments" => "payments", "collection-reports" => "collection_reports",
                    _ => null
                };
                if (parts[1].Equals("admin", StringComparison.OrdinalIgnoreCase) && parts.Length >= 3 && parts[2].Equals("users", StringComparison.OrdinalIgnoreCase)) table = "app_users";
                for (var i = parts.Length - 1; i >= 2; i--)
                    if (Guid.TryParse(parts[i], out var parsed)) { id = parsed; break; }
            }
        }
        if (path.EndsWith("/api/admin/settings", StringComparison.OrdinalIgnoreCase)) return null;
        if (table is null && path.Contains("/api/admin/trash", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                using var doc = JsonDocument.Parse(body ?? "{}"); var root = doc.RootElement;
                if (root.TryGetProperty("entityType", out var type) && type.ValueKind == JsonValueKind.String && SystemAdminService.TrashTables.TryGetValue(type.GetString()!, out table) && root.TryGetProperty("entityId", out var entityId) && Guid.TryParse(entityId.GetString(), out var parsed)) id = parsed;
            }
            catch { return null; }
        }
        return table is null ? null : new Target(table, id);
    }
}
