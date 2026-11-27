using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dar.Common.Pagination;
using DarEltahfeez.Api.Services;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class SystemAdminEndpoints
{
    private static void MapAuditAndTrash(WebApplication app)
    {
        app.MapGet("/api/admin/reset-candidates", async Task<IResult> (NpgsqlDataSource db, CancellationToken ct) =>
        {
            var teacherAttendance = await ReadResetCandidatesAsync(db, """
                SELECT a.id, concat(t.full_name,' · ',c.name,' · ',to_char(a.session_date,'DD/MM/YYYY'),' · ',a.status)
                FROM teacher_attendance a JOIN teachers t ON t.id=a.teacher_id JOIN circles c ON c.id=a.circle_id
                WHERE a.is_trashed=FALSE ORDER BY a.session_date DESC,t.full_name,c.name;
                """, ct);
            var studentAttendance = await ReadResetCandidatesAsync(db, """
                SELECT sa.id, concat(s.full_name,' · ',c.name,' · ',to_char(sa.session_date,'DD/MM/YYYY'),' · ',sa.status)
                FROM student_attendance sa JOIN circle_enrollments ce ON ce.id=sa.enrollment_id
                JOIN students s ON s.id=ce.student_id JOIN circles c ON c.id=ce.circle_id
                WHERE sa.is_trashed=FALSE ORDER BY sa.session_date DESC,s.full_name,c.name;
                """, ct);
            var scheduleSlots = await ReadResetCandidatesAsync(db, """
                SELECT ss.id, concat(c.name,' · ',CASE ss.day_of_week WHEN 0 THEN 'الأحد' WHEN 1 THEN 'الاثنين' WHEN 2 THEN 'الثلاثاء' WHEN 3 THEN 'الأربعاء' WHEN 4 THEN 'الخميس' WHEN 5 THEN 'الجمعة' ELSE 'السبت' END,' · ',to_char(ss.starts_at,'HH24:MI'))
                FROM circle_schedule_slots ss JOIN circles c ON c.id=ss.circle_id
                WHERE ss.is_trashed=FALSE ORDER BY c.name,ss.day_of_week,ss.starts_at;
                """, ct);
            var monthlyCharges = await ReadResetCandidatesAsync(db, """
                SELECT mc.id, concat(s.full_name,' · ',c.name,' · ',mc.billing_month::text)
                FROM monthly_charges mc JOIN circle_enrollments ce ON ce.id=mc.enrollment_id
                JOIN students s ON s.id=ce.student_id JOIN circles c ON c.id=ce.circle_id
                WHERE mc.is_trashed=FALSE AND mc.voided_at IS NULL ORDER BY mc.billing_month DESC,s.full_name;
                """, ct);
            var payments = await ReadResetCandidatesAsync(db, """
                SELECT p.id, concat(s.full_name,' · ',c.name,' · ',to_char(p.paid_at,'DD/MM/YYYY'))
                FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id
                JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN students s ON s.id=ce.student_id JOIN circles c ON c.id=ce.circle_id
                WHERE p.is_trashed=FALSE AND p.voided_at IS NULL ORDER BY p.paid_at DESC,s.full_name;
                """, ct);
            var advertisingExpenses = await ReadResetCandidatesAsync(db, """
                SELECT a.id, concat(c.name,' · ',COALESCE(a.platform,'إعلان'),' · ',to_char(a.start_date,'DD/MM/YYYY'))
                FROM advertising_expenses a JOIN circles c ON c.id=a.circle_id
                WHERE a.is_trashed=FALSE ORDER BY a.start_date DESC,c.name;
                """, ct);
            var operatingExpenses = await ReadResetCandidatesAsync(db, """
                SELECT o.id, concat(to_char(o.expense_date,'DD/MM/YYYY'),' · ',COALESCE(c.name,'مصروف عام للدار'),' · مصروف تشغيلي')
                FROM operating_expenses o LEFT JOIN circles c ON c.id=o.circle_id
                WHERE o.is_trashed=FALSE ORDER BY o.expense_date DESC,o.description;
                """, ct);
            // The full list is used by selective reset. The all-operational reset only adds unlinked school-wide expenses,
            // because circle-linked expenses are moved to Trash as children of each circle.
            var generalOperatingExpenses = await ReadResetCandidatesAsync(db, """
                SELECT o.id, concat(to_char(o.expense_date,'DD/MM/YYYY'),' · مصروف عام للدار · مصروف تشغيلي')
                FROM operating_expenses o
                WHERE o.circle_id IS NULL AND o.is_trashed=FALSE
                ORDER BY o.expense_date DESC,o.description;
                """, ct);
            var collectionReports = await ReadResetCandidatesAsync(db, """
                SELECT id, concat(title,' · ',billing_month::text)
                FROM collection_reports WHERE is_trashed=FALSE ORDER BY billing_month DESC,title;
                """, ct);
            return Results.Ok(new { teacherAttendance, studentAttendance, scheduleSlots, monthlyCharges, payments, advertisingExpenses, operatingExpenses, generalOperatingExpenses, collectionReports });
        }).RequireAuthorization("trash.manage");

        app.MapPost("/api/admin/audit-events", async Task<IResult> (AdminAuditEventRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var allowed = new[] { "report.create", "export.json", "export.xml", "data.reset" };
            if (!allowed.Contains(request.ActionCode, StringComparer.Ordinal)) return Results.BadRequest(new { message = "نوع العملية المطلوب تسجيلها غير مدعوم." });
            var permitted = request.ActionCode == "data.reset"
                ? principal.HasClaim("permission", "trash.manage")
                : request.ActionCode.StartsWith("export.", StringComparison.Ordinal)
                    ? principal.HasClaim("permission", "exports.manage")
                    : new[] { "exports.manage", "attendance.read", "attendance.edit", "students.read", "teachers.read", "circles.read", "finance.read" }
                        .Any(code => principal.HasClaim("permission", code));
            if (!permitted) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(request.EntityType) || request.EntityType.Length > 80) return Results.BadRequest(new { message = "نوع السجل غير صحيح." });
            var details = request.Details.HasValue ? request.Details.Value.GetRawText() : "{}";
            if (details.Length > 8000) return Results.BadRequest(new { message = "تفاصيل سجل العملية أطول من المسموح." });
            await using var cmd = db.CreateCommand("INSERT INTO audit_log(actor_user_id,actor_display_name,action_code,entity_type,entity_id,details,request_path,http_method,can_restore) VALUES(@actor,@name,@action,@type,@id,@details::jsonb,@path,'POST',FALSE) RETURNING id;");
            cmd.Parameters.AddWithValue("actor", DbGuid(ActorId(principal))); cmd.Parameters.AddWithValue("name", principal.FindFirstValue("display_name") ?? "حساب غير معروف");
            cmd.Parameters.AddWithValue("action", request.ActionCode); cmd.Parameters.AddWithValue("type", request.EntityType); cmd.Parameters.AddWithValue("id", (object?)request.EntityId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("details", NpgsqlDbType.Jsonb, details); cmd.Parameters.AddWithValue("path", "/api/admin/audit-events");
            var id = (long)(await cmd.ExecuteScalarAsync(ct) ?? 0L);
            return Results.Ok(new { id, logged = true });
        }).RequireAuthorization();

        app.MapGet("/api/admin/audit-log", async Task<IResult> (int? limit, string? month, int? page, int? pageSize, HttpContext http, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var financeVisible = CanReadFinance(principal);
            var paging = new PageRequest(page, pageSize);
            var paged = page is not null || pageSize is not null;
            var take = paged ? paging.PageSize : Math.Clamp(limit ?? 500, 1, 10000);
            DateOnly? monthStart = null;
            if (!string.IsNullOrWhiteSpace(month))
            {
                if (!DateOnly.TryParseExact(month + "-01", "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var parsedMonth))
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
                monthStart = parsedMonth;
            }
            await using var cmd = db.CreateCommand("SELECT l.id,l.actor_user_id,COALESCE(l.actor_display_name,u.display_name,'حساب غير معروف'),l.action_code,l.entity_type,l.entity_id,l.occurred_at,l.details::text,l.before_data::text,l.after_data::text,l.can_restore,l.restored_at,COUNT(*) OVER() AS total FROM audit_log AS l LEFT JOIN app_users AS u ON u.id=l.actor_user_id WHERE (@month IS NULL OR ((l.occurred_at AT TIME ZONE 'Africa/Cairo') >= @month::date AND (l.occurred_at AT TIME ZONE 'Africa/Cairo') < (@month::date + INTERVAL '1 month'))) ORDER BY l.occurred_at DESC,l.id DESC LIMIT @limit OFFSET @skip;");
            var monthParameter = cmd.Parameters.Add("month", NpgsqlDbType.Date);
            monthParameter.Value = monthStart.HasValue ? (object)monthStart.Value : DBNull.Value;
            cmd.Parameters.AddWithValue("limit", take);
            cmd.Parameters.AddWithValue("skip", paged ? paging.Offset : 0L);
            var rows = new List<object>(); long total = 0;
            await using (var r = await cmd.ExecuteReaderAsync(ct))
            {
                while (await r.ReadAsync(ct))
                {
                    total = r.ReadTotal();
                    rows.Add(new
                    {
                        id = r.GetInt64(0), actorUserId = r.IsDBNull(1) ? (Guid?)null : r.GetGuid(1), actorName = r.GetString(2), actionCode = r.GetString(3),
                        entityType = r.GetString(4), entityId = r.IsDBNull(5) ? (Guid?)null : r.GetGuid(5), occurredAt = r.GetFieldValue<DateTimeOffset>(6),
                        details = ParseJsonForFinance(r.IsDBNull(7) ? null : r.GetString(7), financeVisible),
                        beforeData = ParseJsonForFinance(r.IsDBNull(8) ? null : r.GetString(8), financeVisible),
                        afterData = ParseJsonForFinance(r.IsDBNull(9) ? null : r.GetString(9), financeVisible),
                        canRestore = r.GetBoolean(10), restoredAt = r.IsDBNull(11) ? (DateTimeOffset?)null : r.GetFieldValue<DateTimeOffset>(11)
                    });
                }
            }
            total = await PaginationRules.EnsureTotalAsync(cmd, total, paged, ct);
            PaginationHeaderWriter.Write(http.Response, total, paging, rows.Count, paged);
            return Results.Ok(rows);
        }).RequireAuthorization("audit.read");

        app.MapPost("/api/admin/audit-log/{id:long}/restore-before", async Task<IResult> (long id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var conn = await db.OpenConnectionAsync(ct); await using var tx = await conn.BeginTransactionAsync(ct);
            string? entity; Guid? entityId; string? snapshot; bool alreadyRestored;
            await using (var get = new NpgsqlCommand("SELECT entity_type,entity_id,before_data::text,restored_at IS NOT NULL FROM audit_log WHERE id=@id AND can_restore=TRUE FOR UPDATE;", conn, tx))
            { get.Parameters.AddWithValue("id", id); await using var r = await get.ExecuteReaderAsync(ct); if (!await r.ReadAsync(ct)) return Results.NotFound(new { message = "هذا السجل لا يحتوي على نسخة سابقة قابلة للاسترجاع." }); entity = r.GetString(0); entityId = r.IsDBNull(1) ? null : r.GetGuid(1); snapshot = r.IsDBNull(2) ? null : r.GetString(2); alreadyRestored = r.GetBoolean(3); }
            if (alreadyRestored) return Results.Conflict(new { message = "تم استرجاع هذا التعديل من قبل." });
            if (entityId is null || snapshot is null || !SystemAdminService.RestoreColumns.TryGetValue(entity!, out var columns)) return Results.BadRequest(new { message = "هذا النوع من التعديلات لا يدعم الاسترجاع الآمن بعد." });
            if (ContainsFinancialJsonFields(snapshot) && !CanEditFinancialValues(principal))
                return Results.Forbid();
            var beforeNow = await ReadSnapshotAsync(conn, tx, entity!, entityId.Value, ct);
            if (beforeNow is null) return Results.Conflict(new { message = "السجل الأصلي غير موجود؛ استخدم سلة المهملات إذا كان محذوفًا مؤقتًا." });
            var assignments = string.Join(",", columns.Select(c => $"{c}=source.{c}"));
            var sql = $"UPDATE public.{entity} AS target SET {assignments} FROM jsonb_populate_record(NULL::public.{entity}, @snapshot::jsonb) AS source WHERE target.id=@entityId;";
            await using (var restore = new NpgsqlCommand(sql, conn, tx)) { restore.Parameters.AddWithValue("snapshot", NpgsqlDbType.Jsonb, snapshot); restore.Parameters.AddWithValue("entityId", entityId.Value); await restore.ExecuteNonQueryAsync(ct); }
            await using (var mark = new NpgsqlCommand("UPDATE audit_log SET restored_at=now(),can_restore=FALSE WHERE id=@id;", conn, tx)) { mark.Parameters.AddWithValue("id", id); await mark.ExecuteNonQueryAsync(ct); }
            await using (var log = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,actor_display_name,action_code,entity_type,entity_id,details,before_data,after_data,request_path,http_method,can_restore) VALUES(@actor,@name,'audit.restore_before',@type,@entityId,jsonb_build_object('sourceAuditId',@source),@before::jsonb,@after::jsonb,'/api/admin/audit-log/'||@source||'/restore-before','POST',TRUE);", conn, tx))
            { log.Parameters.AddWithValue("actor", DbGuid(ActorId(principal))); log.Parameters.AddWithValue("name", principal.FindFirstValue("display_name") ?? ""); log.Parameters.AddWithValue("type", entity!); log.Parameters.AddWithValue("entityId", entityId.Value); log.Parameters.AddWithValue("source", id); log.Parameters.AddWithValue("before", NpgsqlDbType.Jsonb, beforeNow); log.Parameters.AddWithValue("after", NpgsqlDbType.Jsonb, snapshot); await log.ExecuteNonQueryAsync(ct); }
            await tx.CommitAsync(ct);
            return Results.Ok(new { restored = true, message = "تمت استعادة القيم السابقة. راجع السجل الجديد للتأكد." });
        }).RequireAuthorization("audit.restore").AddEndpointFilter<ScopedAccessEndpointFilter>();

        app.MapGet("/api/admin/trash", async Task<IResult> (int? page, int? pageSize, HttpContext http, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var financeVisible = CanReadFinance(principal);
            var paging = new PageRequest(page, pageSize);
            var paged = page is not null || pageSize is not null;
            var take = paged ? paging.PageSize : 5000;
            await using var cmd = db.CreateCommand("SELECT id,entity_type,entity_id,display_name,deleted_by_name,deleted_at,expires_at,purged_at,purge_error,record_snapshot::text,COUNT(*) OVER() AS total FROM trash_items WHERE restored_at IS NULL AND purged_at IS NULL ORDER BY deleted_at DESC,id DESC LIMIT @take OFFSET @skip;");
            cmd.Parameters.AddWithValue("take", take);
            cmd.Parameters.AddWithValue("skip", paged ? paging.Offset : 0L);
            var rows = new List<object>(); long total = 0;
            await using (var r = await cmd.ExecuteReaderAsync(ct))
            {
                while (await r.ReadAsync(ct))
                {
                    total = r.ReadTotal();
                    rows.Add(new { id = r.GetGuid(0), entityType = r.GetString(1), entityId = r.GetGuid(2), displayName = financeVisible ? r.GetString(3) : GetFinanceSafeTrashDisplayName(r.GetString(1)), deletedByName = r.IsDBNull(4) ? "غير معروف" : r.GetString(4), deletedAt = r.GetFieldValue<DateTimeOffset>(5), expiresAt = r.GetFieldValue<DateTimeOffset>(6), purgedAt = r.IsDBNull(7) ? (DateTimeOffset?)null : r.GetFieldValue<DateTimeOffset>(7), purgeError = r.IsDBNull(8) ? null : r.GetString(8), recordSnapshot = ParseJsonForFinance(r.IsDBNull(9) ? null : r.GetString(9), financeVisible) });
                }
            }
            total = await PaginationRules.EnsureTotalAsync(cmd, total, paged, ct);
            PaginationHeaderWriter.Write(http.Response, total, paging, rows.Count, paged);
            return Results.Ok(rows);
        }).RequireAuthorization("trash.manage");

        app.MapPost("/api/admin/trash", async Task<IResult> (TrashCreateRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) => await MoveToTrashAsync(request, principal, db, ct)).RequireAuthorization("trash.manage").AddEndpointFilter<ScopedAccessEndpointFilter>();
        app.MapPost("/api/admin/trash/{id:guid}/restore", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) => await RestoreTrashAsync(id, principal, db, ct)).RequireAuthorization("trash.manage").AddEndpointFilter<ScopedAccessEndpointFilter>();
        app.MapDelete("/api/admin/trash/{id:guid}", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) => await PurgeTrashAsync(id, principal, db, ct)).RequireAuthorization("trash.manage").AddEndpointFilter<ScopedAccessEndpointFilter>();

    }
}
