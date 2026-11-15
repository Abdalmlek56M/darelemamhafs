using System.Collections.Generic;
using System.IO;
using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using DarEltahfeez.Api.Services;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static class SystemAdminEndpoints
{
    private static readonly IReadOnlyDictionary<string, string> DisplayNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["students"] = "الطلاب", ["student_notes"] = "ملاحظات الطلاب", ["teacher_notes"] = "ملاحظات المعلمات", ["circle_enrollments"] = "التحاقات الحلقات",
        ["monthly_charges"] = "الاستحقاقات", ["payments"] = "التحصيلات", ["teachers"] = "المعلمات", ["circles"] = "الحلقات",
        ["circle_schedule_slots"] = "مواعيد الحلقات", ["teacher_attendance"] = "حضور المعلمات", ["student_attendance"] = "حضور الطلاب", ["advertising_expenses"] = "الإعلانات",
        ["operating_expenses"] = "المصروفات التشغيلية", ["collection_reports"] = "تقارير التحصيل", ["school_settings"] = "إعدادات الدار",
        ["app_users"] = "الحسابات", ["user_permissions"] = "صلاحيات الحسابات", ["audit_log"] = "سجل التدقيق", ["trash_items"] = "سلة المهملات", ["system_backups"] = "سجل النسخ الاحتياطية"
    };

    public static void Map(WebApplication app)
    {
        app.MapGet("/api/branding", async Task<IResult> (NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var cmd = db.CreateCommand("SELECT brand_name,logo_data,logo_content_type,facebook_url,tiktok_url,whatsapp_url FROM school_settings WHERE id=1;");
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return Results.Ok(new BrandingResponse("دار الإمام حفص للقرآن والتجويد", null, null, null, null));
            return Results.Ok(new BrandingResponse(r.GetString(0), r.IsDBNull(1) ? null : $"data:{(r.IsDBNull(2) ? "image/png" : r.GetString(2))};base64,{Convert.ToBase64String((byte[])r[1])}", r.IsDBNull(3) ? null : r.GetString(3), r.IsDBNull(4) ? null : r.GetString(4), r.IsDBNull(5) ? null : r.GetString(5)));
        }).AllowAnonymous();

        app.MapGet("/api/admin/settings", async Task<IResult> (NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var cmd = db.CreateCommand("SELECT brand_name,logo_data,logo_content_type,facebook_url,tiktok_url,whatsapp_url,trash_retention_days,updated_at FROM school_settings WHERE id=1;");
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return Results.Problem("إعدادات الدار غير مهيأة.");
            return Results.Ok(new AdminSettingsResponse(
                r.GetString(0), r.IsDBNull(1) ? null : $"data:{(r.IsDBNull(2) ? "image/png" : r.GetString(2))};base64,{Convert.ToBase64String((byte[])r[1])}",
                r.IsDBNull(3) ? "" : r.GetString(3), r.IsDBNull(4) ? "" : r.GetString(4), r.IsDBNull(5) ? "" : r.GetString(5),
                r.GetInt32(6), r.GetFieldValue<DateTimeOffset>(7)));
        }).RequireAuthorization("settings.manage");

        app.MapPut("/api/admin/settings", async Task<IResult> (AdminSettingsWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.BrandName) || request.BrandName.Trim().Length > 200)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["brandName"] = ["اكتب اسم الدار في حدود 200 حرف."] });
            if (request.TrashRetentionDays is < 1 or > 3650)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["trashRetentionDays"] = ["مدة الاحتفاظ يجب أن تكون من يوم إلى 3650 يومًا."] });
            foreach (var (field, url) in new[] { ("facebookUrl", request.FacebookUrl), ("tiktokUrl", request.TiktokUrl), ("whatsappUrl", request.WhatsappUrl) })
                if (!IsSafeHttpsUrl(url)) return Results.ValidationProblem(new Dictionary<string, string[]> { [field] = ["استخدم رابطًا كاملًا يبدأ بـ https:// أو اترك الحقل فارغًا."] });

            byte[]? logoBytes = null; string? logoType = null;
            if (!string.IsNullOrWhiteSpace(request.LogoDataUrl))
            {
                var match = Regex.Match(request.LogoDataUrl, @"^data:(image/png|image/jpeg|image/webp);base64,([A-Za-z0-9+/=]+)$", RegexOptions.IgnoreCase);
                if (!match.Success) return Results.ValidationProblem(new Dictionary<string, string[]> { ["logoDataUrl"] = ["الشعار يجب أن يكون PNG أو JPG أو WebP."] });
                try { logoBytes = Convert.FromBase64String(match.Groups[2].Value); }
                catch (FormatException) { return Results.ValidationProblem(new Dictionary<string, string[]> { ["logoDataUrl"] = ["ملف الشعار غير صالح."] }); }
                if (logoBytes.Length > 2 * 1024 * 1024) return Results.ValidationProblem(new Dictionary<string, string[]> { ["logoDataUrl"] = ["حجم الشعار يجب ألا يتجاوز 2 ميجابايت."] });
                logoType = match.Groups[1].Value.ToLowerInvariant();
            }

            var settingsBefore = await ReadBrandingAuditSnapshotAsync(db, ct);
            await using var cmd = db.CreateCommand("""
                UPDATE school_settings SET brand_name=@name,
                  logo_data=CASE WHEN @clearLogo THEN NULL WHEN @newLogo THEN @logo ELSE logo_data END,
                  logo_content_type=CASE WHEN @clearLogo THEN NULL WHEN @newLogo THEN @contentType ELSE logo_content_type END,
                  facebook_url=@facebook,tiktok_url=@tiktok,whatsapp_url=@whatsapp,
                  trash_retention_days=@retention,
                  updated_by=@actor,updated_at=now() WHERE id=1;
                """);
            cmd.Parameters.AddWithValue("name", request.BrandName.Trim()); cmd.Parameters.AddWithValue("clearLogo", request.ClearLogo);
            cmd.Parameters.AddWithValue("newLogo", logoBytes is not null); cmd.Parameters.AddWithValue("logo", (object?)logoBytes ?? DBNull.Value);
            cmd.Parameters.AddWithValue("contentType", (object?)logoType ?? DBNull.Value); cmd.Parameters.AddWithValue("facebook", NullIfEmpty(request.FacebookUrl));
            cmd.Parameters.AddWithValue("tiktok", NullIfEmpty(request.TiktokUrl)); cmd.Parameters.AddWithValue("whatsapp", NullIfEmpty(request.WhatsappUrl));
            cmd.Parameters.AddWithValue("retention", request.TrashRetentionDays);
            cmd.Parameters.AddWithValue("actor", DbGuid(ActorId(principal)));
            await cmd.ExecuteNonQueryAsync(ct);
            var settingsAfter = await ReadBrandingAuditSnapshotAsync(db, ct);
            await using (var audit = db.CreateCommand("INSERT INTO audit_log(actor_user_id,actor_display_name,action_code,entity_type,entity_id,details,before_data,after_data,request_path,http_method,can_restore) VALUES(@actor,@actorName,'settings.update','school_settings',NULL,@details::jsonb,@before::jsonb,@after::jsonb,'/api/admin/settings','PUT',FALSE);"))
            {
                audit.Parameters.AddWithValue("actor", DbGuid(ActorId(principal)));
                audit.Parameters.AddWithValue("actorName", principal.FindFirstValue("display_name") ?? "حساب غير معروف");
                audit.Parameters.AddWithValue("details", NpgsqlDbType.Jsonb, JsonSerializer.Serialize(new { logoChanged = logoBytes is not null || request.ClearLogo, note = "تعديل هوية الدار وسياسات النظام" }));
                audit.Parameters.AddWithValue("before", NpgsqlDbType.Jsonb, (object?)settingsBefore ?? DBNull.Value);
                audit.Parameters.AddWithValue("after", NpgsqlDbType.Jsonb, (object?)settingsAfter ?? DBNull.Value);
                await audit.ExecuteNonQueryAsync(ct);
            }
            return Results.Ok(new { saved = true, message = "تم حفظ إعدادات الدار." });
        }).RequireAuthorization("settings.manage");

        app.MapGet("/api/auth/profile/avatar", async Task<IResult> (ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (ActorId(principal) is not Guid id) return Results.Unauthorized();
            await using var cmd = db.CreateCommand("SELECT avatar_data,avatar_content_type FROM app_users WHERE id=@id AND is_active=TRUE;"); cmd.Parameters.AddWithValue("id", id);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct) || r.IsDBNull(0)) return Results.NotFound();
            var bytes = (byte[])r[0]; var type = r.IsDBNull(1) ? "image/png" : r.GetString(1);
            return Results.File(bytes, type, enableRangeProcessing: false);
        }).RequireAuthorization();

        app.MapPut("/api/auth/profile/avatar", async Task<IResult> (ProfileAvatarRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (ActorId(principal) is not Guid id) return Results.Unauthorized();
            var match = Regex.Match(request.DataUrl ?? "", @"^data:(image/png|image/jpeg|image/webp);base64,([A-Za-z0-9+/=]+)$", RegexOptions.IgnoreCase);
            if (!match.Success) return Results.ValidationProblem(new Dictionary<string, string[]> { ["dataUrl"] = ["اختر صورة PNG أو JPG أو WebP."] });
            byte[] bytes; try { bytes = Convert.FromBase64String(match.Groups[2].Value); } catch (FormatException) { return Results.BadRequest(new { message = "الصورة غير صالحة." }); }
            if (bytes.Length > 2 * 1024 * 1024) return Results.BadRequest(new { message = "حجم الصورة يجب ألا يتجاوز 2 ميجابايت." });
            await using var cmd = db.CreateCommand("UPDATE app_users SET avatar_data=@data,avatar_content_type=@type,updated_at=now() WHERE id=@id AND is_active=TRUE;");
            cmd.Parameters.AddWithValue("data", bytes); cmd.Parameters.AddWithValue("type", match.Groups[1].Value.ToLowerInvariant()); cmd.Parameters.AddWithValue("id", id);
            if (await cmd.ExecuteNonQueryAsync(ct) == 0) return Results.NotFound();
            await InsertAuditAsync(db, id, principal.FindFirstValue("display_name"), "profile.avatar.update", "app_users", id, null, JsonSerializer.Serialize(new { avatarUpdated = true }), "/api/auth/profile/avatar", "PUT", false, ct);
            return Results.Ok(new { saved = true });
        }).RequireAuthorization();

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
                WHERE mc.is_trashed=FALSE ORDER BY mc.billing_month DESC,s.full_name;
                """, ct);
            var payments = await ReadResetCandidatesAsync(db, """
                SELECT p.id, concat(s.full_name,' · ',c.name,' · ',to_char(p.paid_at,'DD/MM/YYYY'))
                FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id
                JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN students s ON s.id=ce.student_id JOIN circles c ON c.id=ce.circle_id
                WHERE p.is_trashed=FALSE ORDER BY p.paid_at DESC,s.full_name;
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

        app.MapGet("/api/admin/audit-log", async Task<IResult> (int? limit, string? month, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var financeVisible = CanReadFinance(principal);
            var take = Math.Clamp(limit ?? 500, 1, 10000);
            DateOnly? monthStart = null;
            if (!string.IsNullOrWhiteSpace(month))
            {
                if (!DateOnly.TryParseExact(month + "-01", "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var parsedMonth))
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
                monthStart = parsedMonth;
            }
            await using var cmd = db.CreateCommand("SELECT l.id,l.actor_user_id,COALESCE(l.actor_display_name,u.display_name,'حساب غير معروف'),l.action_code,l.entity_type,l.entity_id,l.occurred_at,l.details::text,l.before_data::text,l.after_data::text,l.can_restore,l.restored_at FROM audit_log AS l LEFT JOIN app_users AS u ON u.id=l.actor_user_id WHERE (@month IS NULL OR ((l.occurred_at AT TIME ZONE 'Africa/Cairo') >= @month::date AND (l.occurred_at AT TIME ZONE 'Africa/Cairo') < (@month::date + INTERVAL '1 month'))) ORDER BY l.occurred_at DESC,l.id DESC LIMIT @limit;");
            var monthParameter = cmd.Parameters.Add("month", NpgsqlDbType.Date);
            monthParameter.Value = monthStart.HasValue ? (object)monthStart.Value : DBNull.Value;
            cmd.Parameters.AddWithValue("limit", take);
            var rows = new List<object>(); await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) rows.Add(new
            {
                id = r.GetInt64(0), actorUserId = r.IsDBNull(1) ? (Guid?)null : r.GetGuid(1), actorName = r.GetString(2), actionCode = r.GetString(3),
                entityType = r.GetString(4), entityId = r.IsDBNull(5) ? (Guid?)null : r.GetGuid(5), occurredAt = r.GetFieldValue<DateTimeOffset>(6),
                details = ParseJsonForFinance(r.IsDBNull(7) ? null : r.GetString(7), financeVisible),
                beforeData = ParseJsonForFinance(r.IsDBNull(8) ? null : r.GetString(8), financeVisible),
                afterData = ParseJsonForFinance(r.IsDBNull(9) ? null : r.GetString(9), financeVisible),
                canRestore = r.GetBoolean(10), restoredAt = r.IsDBNull(11) ? (DateTimeOffset?)null : r.GetFieldValue<DateTimeOffset>(11)
            });
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
        }).RequireAuthorization("audit.restore");

        app.MapGet("/api/admin/trash", async Task<IResult> (ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var financeVisible = CanReadFinance(principal);
            await using var cmd = db.CreateCommand("SELECT id,entity_type,entity_id,display_name,deleted_by_name,deleted_at,expires_at,purged_at,purge_error,record_snapshot::text FROM trash_items WHERE restored_at IS NULL AND purged_at IS NULL ORDER BY deleted_at DESC LIMIT 5000;");
            var rows = new List<object>(); await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) rows.Add(new { id = r.GetGuid(0), entityType = r.GetString(1), entityId = r.GetGuid(2), displayName = financeVisible ? r.GetString(3) : GetFinanceSafeTrashDisplayName(r.GetString(1)), deletedByName = r.IsDBNull(4) ? "غير معروف" : r.GetString(4), deletedAt = r.GetFieldValue<DateTimeOffset>(5), expiresAt = r.GetFieldValue<DateTimeOffset>(6), purgedAt = r.IsDBNull(7) ? (DateTimeOffset?)null : r.GetFieldValue<DateTimeOffset>(7), purgeError = r.IsDBNull(8) ? null : r.GetString(8), recordSnapshot = ParseJsonForFinance(r.IsDBNull(9) ? null : r.GetString(9), financeVisible) });
            return Results.Ok(rows);
        }).RequireAuthorization("trash.manage");

        app.MapPost("/api/admin/trash", async Task<IResult> (TrashCreateRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) => await MoveToTrashAsync(request, principal, db, ct)).RequireAuthorization("trash.manage");
        app.MapPost("/api/admin/trash/{id:guid}/restore", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) => await RestoreTrashAsync(id, principal, db, ct)).RequireAuthorization("trash.manage");
        app.MapDelete("/api/admin/trash/{id:guid}", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) => await PurgeTrashAsync(id, principal, db, ct)).RequireAuthorization("trash.manage");

        app.MapGet("/api/admin/backups", async Task<IResult> (NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var cmd = db.CreateCommand("SELECT id,backup_file_name,scope_codes,backup_format,status,file_size_bytes,started_at,completed_at,created_by_name,error_message FROM system_backups ORDER BY started_at DESC LIMIT 100;");
            var rows = new List<object>(); await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) rows.Add(new { id = r.GetGuid(0), fileName = r.GetString(1), scopes = r.GetString(2), format = r.GetString(3), status = r.GetString(4), sizeBytes = r.IsDBNull(5) ? (long?)null : r.GetInt64(5), startedAt = r.GetFieldValue<DateTimeOffset>(6), completedAt = r.IsDBNull(7) ? (DateTimeOffset?)null : r.GetFieldValue<DateTimeOffset>(7), createdByName = r.IsDBNull(8) ? "نسخ احتياطي تلقائي" : r.GetString(8), errorMessage = r.IsDBNull(9) ? null : r.GetString(9) });
            return Results.Ok(rows);
        }).RequireAuthorization("backup.manage");

        app.MapPost("/api/admin/backups", async Task<IResult> (BackupCreateRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, SystemAdminService service, CancellationToken ct) =>
        {
            try
            {
                var result = await service.CreateBackupAsync(request.Scopes ?? ["all"], ActorId(principal), principal.FindFirstValue("display_name"), ct);
                await InsertAuditAsync(db, ActorId(principal), principal.FindFirstValue("display_name"), "backup.created", "system_backup", result.Id,
                    null, JsonSerializer.Serialize(new { result.FileName, result.ScopeCodes, result.SizeBytes, result.CreatedAt }), "/api/admin/backups", "POST", false, ct);
                return Results.Ok(result);
            }
            catch (ArgumentException ex) { return Results.ValidationProblem(new Dictionary<string, string[]> { ["scopes"] = [ex.Message] }); }
            catch (Exception ex) { return Results.Problem(title: "فشل إنشاء النسخة الاحتياطية", detail: ex.Message, statusCode: 500); }
        }).RequireAuthorization("backup.manage");

        app.MapGet("/api/admin/backups/{id:guid}/download", async Task<IResult> (Guid id, NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var cmd = db.CreateCommand("SELECT backup_file_name,backup_path FROM system_backups WHERE id=@id AND status='completed';"); cmd.Parameters.AddWithValue("id", id);
            await using var r = await cmd.ExecuteReaderAsync(ct); if (!await r.ReadAsync(ct)) return Results.NotFound();
            var fileName = Path.GetFileName(r.GetString(0)); var path = Path.GetFullPath(r.GetString(1));
            var root = Path.GetFullPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DarEltahfeez", "Backups")) + Path.DirectorySeparatorChar;
            if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(path)) return Results.NotFound(new { message = "ملف النسخة الاحتياطية غير موجود في مجلد النسخ المعتمد." });
            return Results.File(path, "application/octet-stream", fileName, enableRangeProcessing: true);
        }).RequireAuthorization("backup.manage");

        app.MapGet("/api/admin/export", async Task<IResult> (string? scopes, string? entityType, Guid? entityId, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var financeVisible = CanReadFinance(principal);
            string[] tables; try { tables = SystemAdminService.TablesForExport((scopes ?? "all").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)); }
            catch (ArgumentException ex) { return Results.BadRequest(new { message = ex.Message }); }
            if (entityId.HasValue && entityType is null) return Results.BadRequest(new { message = "حدد نوع السجل عند تصدير سجل بعينه." });
            if (entityType is not null && !new[] { "student", "teacher", "circle" }.Contains(entityType, StringComparer.Ordinal)) return Results.BadRequest(new { message = "نوع التصدير التفصيلي غير مدعوم." });
            if (entityType is not null) tables = SystemAdminService.TablesForEntityExport(entityType);
            var sections = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            foreach (var table in tables)
            {
                var predicate = entityType is null ? "TRUE" : entityId.HasValue ? ExportEntityPredicate(table, entityType) : ExportEntityFamilyPredicate(table, entityType);
                if (table == "app_users")
                {
                    await using var users = db.CreateCommand($"SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'username',username,'display_name',display_name,'is_active',is_active,'created_at',created_at)), '[]'::jsonb)::text FROM app_users WHERE {predicate};");
                    if (entityId.HasValue) users.Parameters.AddWithValue("entityId", entityId.Value);
                    sections[table] = ParseJson((string?)await users.ExecuteScalarAsync(ct)) ?? JsonDocument.Parse("[]").RootElement.Clone(); continue;
                }
                await using var cmd = db.CreateCommand($"SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'password_hash' - 'receipt_data' - 'logo_data' - 'avatar_data' - 'backup_path'), '[]'::jsonb)::text FROM public.{table} t WHERE {predicate};");
                if (entityId.HasValue) cmd.Parameters.AddWithValue("entityId", entityId.Value);
                var tableJson = (string?)await cmd.ExecuteScalarAsync(ct);
                sections[table] = (financeVisible ? ParseJson(tableJson) : ParseJsonForFinance(tableJson, false)) ?? JsonDocument.Parse("[]").RootElement.Clone();
            }
            await using var brandCmd = db.CreateCommand("SELECT brand_name FROM school_settings WHERE id=1;");
            var brand = (string?)await brandCmd.ExecuteScalarAsync(ct) ?? "دار الإمام حفص للقرآن والتجويد";
            return Results.Ok(new { schoolName = brand, generatedAt = DateTimeOffset.UtcNow, scope = scopes ?? "all", entityType, entityId, sections });
        }).RequireAuthorization("exports.manage");
    }

    private static string ExportEntityFamilyPredicate(string table, string entityType) => (table, entityType) switch
    {
        // Whole-family exports include only related records, not unrelated circles or students from outside the selected family.
        ("students", "student") => "TRUE",
        ("student_notes", "student") => "t.student_id IN (SELECT id FROM students)",
        ("circle_enrollments", "student") => "t.student_id IN (SELECT id FROM students)",
        ("monthly_charges", "student") => "t.enrollment_id IN (SELECT id FROM circle_enrollments WHERE student_id IN (SELECT id FROM students))",
        ("payments", "student") => "t.monthly_charge_id IN (SELECT mc.id FROM monthly_charges mc JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN students s ON s.id=ce.student_id)",
        ("student_attendance", "student") => "t.enrollment_id IN (SELECT id FROM circle_enrollments WHERE student_id IN (SELECT id FROM students))",
        ("circles", "student") => "t.id IN (SELECT circle_id FROM circle_enrollments WHERE student_id IN (SELECT id FROM students))",
        ("teachers", "student") => "t.id IN (SELECT c.teacher_id FROM circles c JOIN circle_enrollments ce ON ce.circle_id=c.id)",
        ("circle_schedule_slots", "student") => "t.circle_id IN (SELECT circle_id FROM circle_enrollments WHERE student_id IN (SELECT id FROM students))",

        ("teachers", "teacher") => "TRUE",
        ("circles", "teacher") => "t.teacher_id IN (SELECT id FROM teachers)",
        ("circle_schedule_slots", "teacher") => "t.circle_id IN (SELECT id FROM circles WHERE teacher_id IN (SELECT id FROM teachers))",
        ("circle_enrollments", "teacher") => "t.circle_id IN (SELECT id FROM circles WHERE teacher_id IN (SELECT id FROM teachers))",
        ("students", "teacher") => "t.id IN (SELECT ce.student_id FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id WHERE c.teacher_id IN (SELECT id FROM teachers))",
        ("teacher_notes", "teacher") => "t.teacher_id IN (SELECT id FROM teachers)",
        ("teacher_attendance", "teacher") => "t.teacher_id IN (SELECT id FROM teachers)",
        ("student_attendance", "teacher") => "t.enrollment_id IN (SELECT ce.id FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id WHERE c.teacher_id IN (SELECT id FROM teachers))",

        ("circles", "circle") => "TRUE",
        ("circle_schedule_slots", "circle") => "t.circle_id IN (SELECT id FROM circles)",
        ("circle_enrollments", "circle") => "t.circle_id IN (SELECT id FROM circles)",
        ("students", "circle") => "t.id IN (SELECT student_id FROM circle_enrollments WHERE circle_id IN (SELECT id FROM circles))",
        ("teachers", "circle") => "t.id IN (SELECT teacher_id FROM circles WHERE teacher_id IS NOT NULL)",
        ("student_notes", "circle") => "t.student_id IN (SELECT student_id FROM circle_enrollments WHERE circle_id IN (SELECT id FROM circles))",
        ("student_attendance", "circle") => "t.enrollment_id IN (SELECT id FROM circle_enrollments WHERE circle_id IN (SELECT id FROM circles))",
        ("teacher_attendance", "circle") => "t.circle_id IN (SELECT id FROM circles)",
        ("monthly_charges", "circle") => "t.enrollment_id IN (SELECT id FROM circle_enrollments WHERE circle_id IN (SELECT id FROM circles))",
        ("payments", "circle") => "t.monthly_charge_id IN (SELECT mc.id FROM monthly_charges mc JOIN circle_enrollments ce ON ce.id=mc.enrollment_id WHERE ce.circle_id IN (SELECT id FROM circles))",
        ("advertising_expenses", "circle") => "t.circle_id IN (SELECT id FROM circles)",
        ("operating_expenses", "circle") => "t.circle_id IN (SELECT id FROM circles)",
        _ => "FALSE"
    };

    private static string ExportEntityPredicate(string table, string entityType) => (table, entityType) switch
    {
        ("students", "student") => "t.id=@entityId",
        ("students", "circle") => "t.id IN (SELECT ce.student_id FROM circle_enrollments ce WHERE ce.circle_id=@entityId)",
        ("students", "teacher") => "t.id IN (SELECT ce.student_id FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id WHERE c.teacher_id=@entityId)",
        ("student_notes", "student") => "t.student_id=@entityId",
        ("student_notes", "circle") => "t.student_id IN (SELECT ce.student_id FROM circle_enrollments ce WHERE ce.circle_id=@entityId)",
        ("student_notes", "teacher") => "t.student_id IN (SELECT ce.student_id FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id WHERE c.teacher_id=@entityId)",
        ("teacher_notes", "teacher") => "t.teacher_id=@entityId",
        ("teachers", "teacher") => "t.id=@entityId",
        ("teachers", "student") => "t.id IN (SELECT c.teacher_id FROM circles c JOIN circle_enrollments ce ON ce.circle_id=c.id WHERE ce.student_id=@entityId)",
        ("teachers", "circle") => "t.id=(SELECT c.teacher_id FROM circles c WHERE c.id=@entityId)",
        ("circles", "circle") => "t.id=@entityId",
        ("circles", "teacher") => "t.teacher_id=@entityId",
        ("circles", "student") => "t.id IN (SELECT ce.circle_id FROM circle_enrollments ce WHERE ce.student_id=@entityId)",
        ("circle_schedule_slots", "circle") => "t.circle_id=@entityId",
        ("circle_schedule_slots", "teacher") => "t.circle_id IN (SELECT c.id FROM circles c WHERE c.teacher_id=@entityId)",
        ("circle_schedule_slots", "student") => "t.circle_id IN (SELECT ce.circle_id FROM circle_enrollments ce WHERE ce.student_id=@entityId)",
        ("circle_enrollments", "student") => "t.student_id=@entityId",
        ("circle_enrollments", "circle") => "t.circle_id=@entityId",
        ("circle_enrollments", "teacher") => "t.circle_id IN (SELECT c.id FROM circles c WHERE c.teacher_id=@entityId)",
        ("monthly_charges", "student") => "t.enrollment_id IN (SELECT ce.id FROM circle_enrollments ce WHERE ce.student_id=@entityId)",
        ("monthly_charges", "circle") => "t.enrollment_id IN (SELECT ce.id FROM circle_enrollments ce WHERE ce.circle_id=@entityId)",
        ("monthly_charges", "teacher") => "t.enrollment_id IN (SELECT ce.id FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id WHERE c.teacher_id=@entityId)",
        ("payments", "student") => "t.monthly_charge_id IN (SELECT mc.id FROM monthly_charges mc JOIN circle_enrollments ce ON ce.id=mc.enrollment_id WHERE ce.student_id=@entityId)",
        ("payments", "circle") => "t.monthly_charge_id IN (SELECT mc.id FROM monthly_charges mc JOIN circle_enrollments ce ON ce.id=mc.enrollment_id WHERE ce.circle_id=@entityId)",
        ("payments", "teacher") => "t.monthly_charge_id IN (SELECT mc.id FROM monthly_charges mc JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN circles c ON c.id=ce.circle_id WHERE c.teacher_id=@entityId)",
        ("teacher_attendance", "teacher") => "t.teacher_id=@entityId",
        ("teacher_attendance", "circle") => "t.circle_id=@entityId",
        ("student_attendance", "student") => "t.enrollment_id IN (SELECT ce.id FROM circle_enrollments ce WHERE ce.student_id=@entityId)",
        ("student_attendance", "circle") => "t.enrollment_id IN (SELECT ce.id FROM circle_enrollments ce WHERE ce.circle_id=@entityId)",
        ("student_attendance", "teacher") => "t.enrollment_id IN (SELECT ce.id FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id WHERE c.teacher_id=@entityId)",
        ("advertising_expenses", "circle") => "t.circle_id=@entityId",
        ("advertising_expenses", "teacher") => "t.circle_id IN (SELECT c.id FROM circles c WHERE c.teacher_id=@entityId)",
        ("operating_expenses", "circle") => "t.circle_id=@entityId",
        ("operating_expenses", "teacher") => "t.circle_id IN (SELECT c.id FROM circles c WHERE c.teacher_id=@entityId)",
        ("collection_reports", _) => "FALSE",
        _ => "FALSE"
    };

    private static async Task<IResult> MoveToTrashAsync(TrashCreateRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct)
    {
        if (!SystemAdminService.TrashTables.TryGetValue(request.EntityType ?? "", out var table)) return Results.BadRequest(new { message = "نوع السجل غير مدعوم في سلة المهملات." });
        var type = request.EntityType!; var retention = 30;
        await using (var getRetention = db.CreateCommand("SELECT trash_retention_days FROM school_settings WHERE id=1;")) retention = (int)(await getRetention.ExecuteScalarAsync(ct) ?? 30);
        await using var connection = await db.OpenConnectionAsync(ct); await using var tx = await connection.BeginTransactionAsync(ct);
        try
        {
            var snapshot = await ReadSnapshotAsync(connection, tx, table, request.EntityId, ct);
            if (snapshot is null) return Results.NotFound(new { message = "السجل غير موجود أو موجود بالفعل في سلة المهملات." });
            var displayName = GetDisplayName(snapshot, table);
            var dependencyError = await CheckTrashDependenciesAsync(connection, tx, type, request.EntityId, ct);
            if (dependencyError is not null) return Results.Conflict(new { message = dependencyError });
            await using (var mark = new NpgsqlCommand($"UPDATE public.{table} SET is_trashed=TRUE WHERE id=@id AND is_trashed=FALSE;", connection, tx))
            { mark.Parameters.AddWithValue("id", request.EntityId); if (await mark.ExecuteNonQueryAsync(ct) == 0) return Results.Conflict(new { message = "السجل موجود بالفعل في سلة المهملات." }); }
            var afterSnapshot = await ReadSnapshotAsync(connection, tx, table, request.EntityId, ct) ?? snapshot;
            var trashId = Guid.NewGuid(); var actor = ActorId(principal); var actorName = principal.FindFirstValue("display_name") ?? principal.Identity?.Name ?? "حساب غير معروف";
            await using (var insert = new NpgsqlCommand("INSERT INTO trash_items(id,entity_type,entity_id,display_name,record_snapshot,deleted_by,deleted_by_name,expires_at) VALUES(@id,@type,@entity,@name,@snapshot::jsonb,@actor,@actorName,now()+(@days||' days')::interval);", connection, tx))
            { insert.Parameters.AddWithValue("id", trashId); insert.Parameters.AddWithValue("type", type); insert.Parameters.AddWithValue("entity", request.EntityId); insert.Parameters.AddWithValue("name", displayName); insert.Parameters.AddWithValue("snapshot", NpgsqlDbType.Jsonb, snapshot); insert.Parameters.AddWithValue("actor", DbGuid(actor)); insert.Parameters.AddWithValue("actorName", actorName); insert.Parameters.AddWithValue("days", retention); await insert.ExecuteNonQueryAsync(ct); }
            await MoveRelatedRecordsToTrashAsync(connection, tx, type, request.EntityId, trashId, retention, actor, actorName, ct);
            await InsertAuditAsync(connection, tx, actor, actorName, "trash.move", table, request.EntityId, snapshot, afterSnapshot, "/api/admin/trash", "POST", false, ct);
            await tx.CommitAsync(ct); return Results.Ok(new { id = trashId, entityId = request.EntityId, expiresAfterDays = retention, message = "تم نقل السجل إلى سلة المهملات، ويمكن استعادته حتى تاريخ انتهاء الاحتفاظ." });
        }
        catch { await tx.RollbackAsync(ct); throw; }
    }

    private static async Task<IResult> RestoreTrashAsync(Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct)
    {
        await using var conn = await db.OpenConnectionAsync(ct); await using var tx = await conn.BeginTransactionAsync(ct);
        try
        {
            string? type = null; Guid entityId = default; string? name = null; Guid? parentTrashId = null;
            await using (var get = new NpgsqlCommand("SELECT entity_type,entity_id,display_name,parent_trash_id FROM trash_items WHERE id=@id AND restored_at IS NULL AND purged_at IS NULL FOR UPDATE;", conn, tx))
            { get.Parameters.AddWithValue("id", id); await using var r = await get.ExecuteReaderAsync(ct); if (!await r.ReadAsync(ct)) return Results.NotFound(); type = r.GetString(0); entityId = r.GetGuid(1); name = r.GetString(2); parentTrashId = r.IsDBNull(3) ? (Guid?)null : r.GetGuid(3); }
            if (parentTrashId is Guid parentId)
            {
                await using var parent = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM trash_items WHERE id=@id AND restored_at IS NULL AND purged_at IS NULL);", conn, tx);
                parent.Parameters.AddWithValue("id", parentId);
                if (Convert.ToBoolean(await parent.ExecuteScalarAsync(ct)))
                    return Results.Conflict(new { message = "استعد السجل الرئيسي أولاً؛ ستُستعاد السجلات التابعة معه تلقائيًا." });
            }
            if (!SystemAdminService.TrashTables.TryGetValue(type!, out var table)) return Results.BadRequest(new { message = "نوع السجل غير مدعوم." });
            await using (var restore = new NpgsqlCommand($"UPDATE public.{table} SET is_trashed=FALSE WHERE id=@id AND is_trashed=TRUE;", conn, tx)) { restore.Parameters.AddWithValue("id", entityId); if (await restore.ExecuteNonQueryAsync(ct) == 0) return Results.Conflict(new { message = "السجل غير موجود أو لا يمكن استعادته." }); }
            await using (var mark = new NpgsqlCommand("UPDATE trash_items SET restored_at=now(),purge_error=NULL WHERE id=@id;", conn, tx)) { mark.Parameters.AddWithValue("id", id); await mark.ExecuteNonQueryAsync(ct); }
            await RestoreRelatedRecordsAsync(conn, tx, id, ct);
            var actor = ActorId(principal); var actorName = principal.FindFirstValue("display_name") ?? "حساب غير معروف";
            await InsertAuditAsync(conn, tx, actor, actorName, "trash.restore", table, entityId, null, JsonSerializer.Serialize(new { restored = true, displayName = CanReadFinance(principal) ? name : GetFinanceSafeTrashDisplayName(type!) }), "/api/admin/trash/restore", "POST", false, ct);
            await tx.CommitAsync(ct); return Results.Ok(new { restored = true, message = "تمت استعادة السجل." });
        }
        catch (PostgresException ex) when (ex.SqlState == "23514" && ex.ConstraintName == "ck_teacher_schedule_no_overlap")
        {
            await tx.RollbackAsync(ct);
            return Results.Conflict(new { message = "لا يمكن استعادة الحلقة أو الموعد؛ ستؤدي الاستعادة إلى تداخل مواعيد المعلمة. راجع جدولها ثم أعد المحاولة." });
        }
        catch { await tx.RollbackAsync(ct); throw; }
    }

    private static async Task<IResult> PurgeTrashAsync(Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct)
    {
        await using var conn = await db.OpenConnectionAsync(ct); await using var tx = await conn.BeginTransactionAsync(ct);
        try
        {
            string? type; Guid entityId; string displayName;
            await using (var get = new NpgsqlCommand("SELECT entity_type,entity_id,display_name FROM trash_items WHERE id=@id AND restored_at IS NULL AND purged_at IS NULL FOR UPDATE;", conn, tx))
            { get.Parameters.AddWithValue("id", id); await using var r = await get.ExecuteReaderAsync(ct); if (!await r.ReadAsync(ct)) return Results.NotFound(); type = r.GetString(0); entityId = r.GetGuid(1); displayName = r.GetString(2); }
            if (SystemAdminService.FinancialTrashTypes.Contains(type!))
                return Results.Conflict(new { message = "لا يمكن الحذف النهائي لسجل مالي أو تاريخي. استخدم إلغاءً أو قيدًا عكسيًا بدل الحذف." });
            if (!SystemAdminService.TrashTables.TryGetValue(type!, out var table)) return Results.BadRequest(new { message = "نوع السجل غير مدعوم." });
            await PurgeRelatedTrashRecordsAsync(conn, tx, id, ct);
            await using (var del = new NpgsqlCommand($"DELETE FROM public.{table} WHERE id=@id AND is_trashed=TRUE;", conn, tx)) { del.Parameters.AddWithValue("id", entityId); if (await del.ExecuteNonQueryAsync(ct) == 0) return Results.Conflict(new { message = "السجل غير موجود أو لم يُنقل إلى المهملات." }); }
            await using (var mark = new NpgsqlCommand("UPDATE trash_items SET purged_at=now(),purge_error=NULL WHERE id=@id;", conn, tx)) { mark.Parameters.AddWithValue("id", id); await mark.ExecuteNonQueryAsync(ct); }
            var actor = ActorId(principal); var actorName = principal.FindFirstValue("display_name") ?? "حساب غير معروف";
            await InsertAuditAsync(conn, tx, actor, actorName, "trash.purge", table, entityId, null, JsonSerializer.Serialize(new { displayName = CanReadFinance(principal) ? displayName : GetFinanceSafeTrashDisplayName(type!), permanentlyDeleted = true }), "/api/admin/trash/purge", "DELETE", false, ct);
            await tx.CommitAsync(ct); return Results.Ok(new { purged = true, message = "تم الحذف النهائي." });
        }
        catch (PostgresException ex) when (ex.SqlState == "23503") { await tx.RollbackAsync(ct); return Results.Conflict(new { message = "لا يمكن الحذف النهائي لأن السجل مرتبط ببيانات أخرى. استعد السجل أو عالج العلاقات أولًا." }); }
        catch { await tx.RollbackAsync(ct); throw; }
    }

    private static async Task<List<object>> ReadResetCandidatesAsync(NpgsqlDataSource db, string sql, CancellationToken ct)
    {
        var rows = new List<object>();
        await using var cmd = db.CreateCommand(sql);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) rows.Add(new { id = reader.GetGuid(0), label = reader.IsDBNull(1) ? "سجل" : reader.GetString(1) });
        return rows;
    }

    private static async Task<string?> CheckTrashDependenciesAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string type, Guid id, CancellationToken ct)
    {
        string? query = type switch
        {
            "teacher" => "SELECT EXISTS(SELECT 1 FROM circles WHERE teacher_id=@id AND is_trashed=FALSE)",
            // Related rows for circles and charges are moved to Trash in the same transaction.
            "circle" => null,
            "monthly-charge" => null,
            _ => null
        };
        if (query is null) return null;
        await using var cmd = new NpgsqlCommand(query, conn, tx); cmd.Parameters.AddWithValue("id", id);
        if ((bool)(await cmd.ExecuteScalarAsync(ct) ?? false)) return type switch
        {
            "teacher" => "لا يمكن نقل المعلمة إلى المهملات ما دامت مرتبطة بحلقة خارج المهملات. انقل الحلقة المرتبطة أولًا أو أعد إسنادها.",
            "circle" => "تعذر نقل الحلقة إلى المهملات.",
            "monthly-charge" => "تعذر نقل الاستحقاق إلى المهملات.",
            _ => "لا يمكن نقل السجل بسبب وجود علاقات نشطة."
        };
        return null;
    }

    private sealed record RelatedTrashRecord(string Type, string Table, Guid Id);

    private static async Task MoveRelatedRecordsToTrashAsync(NpgsqlConnection conn, NpgsqlTransaction tx, string parentType, Guid parentId, Guid parentTrashId, int retentionDays, Guid? actorId, string actorName, CancellationToken ct)
    {
        var sql = parentType switch
        {
            "student" => """
                SELECT 'student-note' AS type,'student_notes' AS table_name,id FROM student_notes WHERE student_id=@id AND is_trashed=FALSE
                UNION ALL SELECT 'student-attendance','student_attendance',sa.id FROM student_attendance sa JOIN circle_enrollments ce ON ce.id=sa.enrollment_id WHERE ce.student_id=@id AND sa.is_trashed=FALSE AND ce.is_trashed=FALSE
                UNION ALL SELECT 'enrollment','circle_enrollments',id FROM circle_enrollments WHERE student_id=@id AND is_trashed=FALSE
                UNION ALL SELECT 'monthly-charge','monthly_charges',mc.id FROM monthly_charges mc JOIN circle_enrollments ce ON ce.id=mc.enrollment_id WHERE ce.student_id=@id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE
                UNION ALL SELECT 'payment','payments',p.id FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id JOIN circle_enrollments ce ON ce.id=mc.enrollment_id WHERE ce.student_id=@id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND p.is_trashed=FALSE;
                """,
            "circle" => """
                SELECT 'schedule-slot' AS type,'circle_schedule_slots' AS table_name,id FROM circle_schedule_slots WHERE circle_id=@id AND is_trashed=FALSE
                UNION ALL SELECT 'enrollment','circle_enrollments',id FROM circle_enrollments WHERE circle_id=@id AND is_trashed=FALSE
                UNION ALL SELECT 'monthly-charge','monthly_charges',mc.id FROM monthly_charges mc JOIN circle_enrollments ce ON ce.id=mc.enrollment_id WHERE ce.circle_id=@id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE
                UNION ALL SELECT 'payment','payments',p.id FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id JOIN circle_enrollments ce ON ce.id=mc.enrollment_id WHERE ce.circle_id=@id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND p.is_trashed=FALSE
                UNION ALL SELECT 'teacher-attendance','teacher_attendance',id FROM teacher_attendance WHERE circle_id=@id AND is_trashed=FALSE
                UNION ALL SELECT 'student-attendance','student_attendance',sa.id FROM student_attendance sa JOIN circle_enrollments ce ON ce.id=sa.enrollment_id WHERE ce.circle_id=@id AND sa.is_trashed=FALSE AND ce.is_trashed=FALSE
                UNION ALL SELECT 'advertising-expense','advertising_expenses',id FROM advertising_expenses WHERE circle_id=@id AND is_trashed=FALSE
                UNION ALL SELECT 'operating-expense','operating_expenses',id FROM operating_expenses WHERE circle_id=@id AND is_trashed=FALSE;
                """,
            "monthly-charge" => "SELECT 'payment' AS type,'payments' AS table_name,id FROM payments WHERE monthly_charge_id=@id AND is_trashed=FALSE;",
            "enrollment" => "SELECT 'student-attendance' AS type,'student_attendance' AS table_name,id FROM student_attendance WHERE enrollment_id=@id AND is_trashed=FALSE UNION ALL SELECT 'monthly-charge','monthly_charges',id FROM monthly_charges WHERE enrollment_id=@id AND is_trashed=FALSE UNION ALL SELECT 'payment','payments',p.id FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id WHERE mc.enrollment_id=@id AND mc.is_trashed=FALSE AND p.is_trashed=FALSE;",
            "schedule-slot" => "SELECT 'teacher-attendance' AS type,'teacher_attendance' AS table_name,id FROM teacher_attendance WHERE schedule_slot_id=@id AND is_trashed=FALSE UNION ALL SELECT 'student-attendance','student_attendance',id FROM student_attendance WHERE schedule_slot_id=@id AND is_trashed=FALSE;",
            "teacher" => "SELECT 'teacher-note' AS type,'teacher_notes' AS table_name,id FROM teacher_notes WHERE teacher_id=@id AND is_trashed=FALSE UNION ALL SELECT 'teacher-attendance' AS type,'teacher_attendance' AS table_name,id FROM teacher_attendance WHERE teacher_id=@id AND is_trashed=FALSE;",
            _ => null
        };
        if (sql is null) return;
        var children = new List<RelatedTrashRecord>();
        await using (var query = new NpgsqlCommand(sql, conn, tx))
        {
            query.Parameters.AddWithValue("id", parentId);
            await using var reader = await query.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) children.Add(new RelatedTrashRecord(reader.GetString(0), reader.GetString(1), reader.GetGuid(2)));
        }
        foreach (var child in children.DistinctBy(x => (x.Table, x.Id)))
        {
            if (!SystemAdminService.TrashTables.ContainsKey(child.Type)) continue;
            var snapshot = await ReadSnapshotAsync(conn, tx, child.Table, child.Id, ct);
            if (snapshot is null) continue;
            await using (var mark = new NpgsqlCommand($"UPDATE public.{child.Table} SET is_trashed=TRUE WHERE id=@id AND is_trashed=FALSE;", conn, tx))
            { mark.Parameters.AddWithValue("id", child.Id); if (await mark.ExecuteNonQueryAsync(ct) == 0) continue; }
            var childTrashId = Guid.NewGuid(); var displayName = GetDisplayName(snapshot, child.Table);
            await using var insert = new NpgsqlCommand("INSERT INTO trash_items(id,entity_type,entity_id,display_name,record_snapshot,parent_trash_id,deleted_by,deleted_by_name,expires_at) VALUES(@id,@type,@entity,@name,@snapshot::jsonb,@parent,@actor,@actorName,now()+(@days||' days')::interval);", conn, tx);
            insert.Parameters.AddWithValue("id", childTrashId); insert.Parameters.AddWithValue("type", child.Type); insert.Parameters.AddWithValue("entity", child.Id); insert.Parameters.AddWithValue("name", displayName); insert.Parameters.AddWithValue("snapshot", NpgsqlDbType.Jsonb, snapshot); insert.Parameters.AddWithValue("parent", parentTrashId); insert.Parameters.AddWithValue("actor", DbGuid(actorId)); insert.Parameters.AddWithValue("actorName", actorName); insert.Parameters.AddWithValue("days", retentionDays);
            await insert.ExecuteNonQueryAsync(ct);
        }
    }

    private static async Task RestoreRelatedRecordsAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Guid parentTrashId, CancellationToken ct)
    {
        var children = new List<RelatedTrashRecord>();
        await using (var query = new NpgsqlCommand("SELECT entity_type,entity_id FROM trash_items WHERE parent_trash_id=@parent AND restored_at IS NULL AND purged_at IS NULL ORDER BY CASE entity_type WHEN 'student-note' THEN 1 WHEN 'teacher-note' THEN 1 WHEN 'schedule-slot' THEN 2 WHEN 'enrollment' THEN 3 WHEN 'teacher-attendance' THEN 4 WHEN 'monthly-charge' THEN 5 WHEN 'payment' THEN 6 WHEN 'advertising-expense' THEN 7 WHEN 'operating-expense' THEN 8 ELSE 9 END,deleted_at;", conn, tx))
        {
            query.Parameters.AddWithValue("parent", parentTrashId); await using var reader = await query.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) if (SystemAdminService.TrashTables.TryGetValue(reader.GetString(0), out var table)) children.Add(new RelatedTrashRecord(reader.GetString(0), table, reader.GetGuid(1)));
        }
        foreach (var child in children)
        {
            await using (var restore = new NpgsqlCommand($"UPDATE public.{child.Table} SET is_trashed=FALSE WHERE id=@id AND is_trashed=TRUE;", conn, tx))
            { restore.Parameters.AddWithValue("id", child.Id); await restore.ExecuteNonQueryAsync(ct); }
            await using (var mark = new NpgsqlCommand("UPDATE trash_items SET restored_at=now(),purge_error=NULL WHERE parent_trash_id=@parent AND entity_type=@type AND entity_id=@id AND restored_at IS NULL AND purged_at IS NULL;", conn, tx))
            { mark.Parameters.AddWithValue("parent", parentTrashId); mark.Parameters.AddWithValue("type", child.Type); mark.Parameters.AddWithValue("id", child.Id); await mark.ExecuteNonQueryAsync(ct); }
        }
    }

    private static async Task PurgeRelatedTrashRecordsAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Guid parentTrashId, CancellationToken ct)
    {
        var children = new List<RelatedTrashRecord>();
        await using (var query = new NpgsqlCommand("SELECT entity_type,entity_id FROM trash_items WHERE parent_trash_id=@parent AND restored_at IS NULL AND purged_at IS NULL ORDER BY CASE entity_type WHEN 'student-note' THEN 1 WHEN 'teacher-note' THEN 1 WHEN 'payment' THEN 2 WHEN 'student-attendance' THEN 3 WHEN 'teacher-attendance' THEN 4 WHEN 'schedule-slot' THEN 5 WHEN 'advertising-expense' THEN 6 WHEN 'operating-expense' THEN 6 WHEN 'monthly-charge' THEN 7 WHEN 'enrollment' THEN 8 ELSE 9 END,deleted_at;", conn, tx))
        {
            query.Parameters.AddWithValue("parent", parentTrashId); await using var reader = await query.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) if (SystemAdminService.TrashTables.TryGetValue(reader.GetString(0), out var table)) children.Add(new RelatedTrashRecord(reader.GetString(0), table, reader.GetGuid(1)));
        }
        foreach (var child in children)
        {
            await using (var delete = new NpgsqlCommand($"DELETE FROM public.{child.Table} WHERE id=@id AND is_trashed=TRUE;", conn, tx))
            { delete.Parameters.AddWithValue("id", child.Id); await delete.ExecuteNonQueryAsync(ct); }
            await using (var mark = new NpgsqlCommand("UPDATE trash_items SET purged_at=now(),purge_error=NULL WHERE parent_trash_id=@parent AND entity_type=@type AND entity_id=@id AND restored_at IS NULL;", conn, tx))
            { mark.Parameters.AddWithValue("parent", parentTrashId); mark.Parameters.AddWithValue("type", child.Type); mark.Parameters.AddWithValue("id", child.Id); await mark.ExecuteNonQueryAsync(ct); }
        }
    }

    private static async Task<string?> ReadBrandingAuditSnapshotAsync(NpgsqlDataSource db, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand("SELECT jsonb_build_object('brand_name',brand_name,'has_logo',logo_data IS NOT NULL,'logo_content_type',logo_content_type,'facebook_url',facebook_url,'tiktok_url',tiktok_url,'whatsapp_url',whatsapp_url,'trash_retention_days',trash_retention_days)::text FROM school_settings WHERE id=1;");
        return (string?)await cmd.ExecuteScalarAsync(ct);
    }

    internal static async Task<string?> ReadSnapshotAsync(NpgsqlDataSource dataSource, string table, Guid id, CancellationToken ct)
    {
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        return await ReadSnapshotAsync(conn, null, table, id, ct);
    }

    internal static async Task<string?> ReadSnapshotAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, string table, Guid id, CancellationToken ct)
    {
        if (!SystemAdminService.RestoreColumns.ContainsKey(table) && !SystemAdminService.TrashTables.Values.Contains(table, StringComparer.OrdinalIgnoreCase) && table != "app_users") return null;
        await using var cmd = new NpgsqlCommand($"SELECT (to_jsonb(t) - 'receipt_data' - 'logo_data' - 'avatar_data' - 'password_hash')::text FROM public.{table} t WHERE id=@id;", conn, tx);
        cmd.Parameters.AddWithValue("id", id); return (string?)await cmd.ExecuteScalarAsync(ct);
    }

    internal static async Task InsertAuditAsync(NpgsqlDataSource db, Guid? actor, string? actorName, string action, string entityType, Guid entityId, string? before, string? after, string path, string method, bool canRestore, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand("INSERT INTO audit_log(actor_user_id,actor_display_name,action_code,entity_type,entity_id,details,before_data,after_data,request_path,http_method,can_restore) VALUES(@actor,@name,@action,@type,@id,'{}'::jsonb,@before::jsonb,@after::jsonb,@path,@method,@restore);");
        cmd.Parameters.AddWithValue("actor", DbGuid(actor)); cmd.Parameters.AddWithValue("name", (object?)actorName ?? DBNull.Value);
        cmd.Parameters.AddWithValue("action", action); cmd.Parameters.AddWithValue("type", entityType); cmd.Parameters.AddWithValue("id", entityId);
        cmd.Parameters.AddWithValue("before", (object?)before ?? DBNull.Value); cmd.Parameters.AddWithValue("after", (object?)after ?? DBNull.Value);
        cmd.Parameters.AddWithValue("path", path); cmd.Parameters.AddWithValue("method", method); cmd.Parameters.AddWithValue("restore", canRestore);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private static async Task InsertAuditAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Guid? actor, string actorName, string action, string entityType, Guid entityId, string? before, string? after, string path, string method, bool canRestore, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,actor_display_name,action_code,entity_type,entity_id,details,before_data,after_data,request_path,http_method,can_restore) VALUES(@actor,@name,@action,@type,@id,'{}'::jsonb,@before::jsonb,@after::jsonb,@path,@method,@restore);", conn, tx);
        cmd.Parameters.AddWithValue("actor", DbGuid(actor)); cmd.Parameters.AddWithValue("name", actorName); cmd.Parameters.AddWithValue("action", action); cmd.Parameters.AddWithValue("type", entityType); cmd.Parameters.AddWithValue("id", entityId);
        cmd.Parameters.AddWithValue("before", (object?)before ?? DBNull.Value); cmd.Parameters.AddWithValue("after", (object?)after ?? DBNull.Value); cmd.Parameters.AddWithValue("path", path); cmd.Parameters.AddWithValue("method", method); cmd.Parameters.AddWithValue("restore", canRestore);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private static bool CanReadFinance(ClaimsPrincipal principal) => principal.HasClaim("permission", "finance.read");
    private static bool CanEditFinancialValues(ClaimsPrincipal principal) => CanReadFinance(principal) && principal.HasClaim("permission", "finance.edit");

    private static readonly HashSet<string> FinancialJsonFields = new(StringComparer.OrdinalIgnoreCase)
    {
        "amount", "amountdue", "amountpaid", "paidamount", "balance", "hourlyrate", "hourlyratesnapshot",
        "payableamount", "payabletotal", "monthlyfee", "agreedmonthlyfee", "currentmonthdue", "currentmonthpaid",
        "currentmonthpaymentstatus", "paymentstatus", "paymentmethod", "dailycost", "totalamount", "monthamount", "totaldue", "totalpaid", "totalbalance",
        "expenseamount", "advertisingcost", "teacherpay", "teacherpayable", "rate", "fee", "cost",
        "receiptdata", "receiptfilename", "receiptcontenttype", "receiptuploadedat"
    };

    private static bool ContainsFinancialJsonFields(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return false;
        using var document = JsonDocument.Parse(json);
        return ContainsFinancialJsonFields(document.RootElement);
    }

    private static bool ContainsFinancialJsonFields(JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in value.EnumerateObject())
                {
                    var normalizedName = property.Name.Replace("_", string.Empty, StringComparison.Ordinal).Replace("-", string.Empty, StringComparison.Ordinal);
                    if (FinancialJsonFields.Contains(normalizedName) || ContainsFinancialJsonFields(property.Value)) return true;
                }
                return false;
            case JsonValueKind.Array:
                return value.EnumerateArray().Any(item => ContainsFinancialJsonFields(item));
            default:
                return false;
        }
    }

    private static JsonElement? ParseJsonForFinance(string? json, bool financeVisible)
    {
        if (financeVisible || string.IsNullOrWhiteSpace(json)) return ParseJson(json);
        using var source = JsonDocument.Parse(json);
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer)) WriteJsonWithoutFinancialFields(source.RootElement, writer);
        using var redacted = JsonDocument.Parse(buffer.ToArray());
        return redacted.RootElement.Clone();
    }

    private static void WriteJsonWithoutFinancialFields(JsonElement value, Utf8JsonWriter writer)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in value.EnumerateObject())
                {
                    writer.WritePropertyName(property.Name);
                    var normalizedName = property.Name.Replace("_", string.Empty, StringComparison.Ordinal).Replace("-", string.Empty, StringComparison.Ordinal);
                    if (FinancialJsonFields.Contains(normalizedName)) writer.WriteNullValue();
                    else WriteJsonWithoutFinancialFields(property.Value, writer);
                }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in value.EnumerateArray()) WriteJsonWithoutFinancialFields(item, writer);
                writer.WriteEndArray();
                break;
            default:
                value.WriteTo(writer);
                break;
        }
    }

    private static JsonElement? ParseJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        using var doc = JsonDocument.Parse(json); return doc.RootElement.Clone();
    }
    private static string GetFinanceSafeTrashDisplayName(string entityType) => entityType switch
    {
        "student" => "طالب",
        "teacher" => "معلمة",
        "circle" => "حلقة",
        "student-note" => "ملاحظة طالب",
        "teacher-note" => "ملاحظة معلمة",
        "enrollment" => "التحاق",
        "monthly-charge" => "استحقاق شهري",
        "payment" => "حركة تحصيل",
        "schedule-slot" => "موعد حلقة",
        "teacher-attendance" => "حضور معلمة",
        "student-attendance" => "حضور طالب",
        "advertising-expense" => "مصروف إعلان",
        "operating-expense" => "مصروف تشغيلي",
        _ => "سجل"
    };

    private static string GetDisplayName(string json, string table)
    {
        if (table == "operating_expenses") return "مصروف تشغيلي";
        if (table == "advertising_expenses") return "إعلان";
        if (table == "payments") return "حركة تحصيل";
        if (table == "monthly_charges") return "استحقاق شهري";
        using var doc = JsonDocument.Parse(json); var root = doc.RootElement;
        foreach (var key in new[] { "full_name", "name", "description", "title", "student_code", "teacher_code", "circle_code", "note_text" })
            if (root.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString())) return value.GetString()!;
        return DisplayNames.GetValueOrDefault(table, table);
    }
    private static bool IsSafeHttpsUrl(string? value) => string.IsNullOrWhiteSpace(value) || (Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && uri.Host.Length > 0);
    private static object DbGuid(Guid? value) => value is Guid guid ? guid : DBNull.Value;
    private static object NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? DBNull.Value : value.Trim();
    internal static Guid? ActorId(ClaimsPrincipal principal) => Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

    private sealed record BrandingResponse(string BrandName, string? LogoDataUrl, string? FacebookUrl, string? TiktokUrl, string? WhatsappUrl);
    private sealed record AdminSettingsResponse(string BrandName, string? LogoDataUrl, string FacebookUrl, string TiktokUrl, string WhatsappUrl, int TrashRetentionDays, DateTimeOffset UpdatedAt);
    private sealed record AdminSettingsWriteRequest(string BrandName, string? LogoDataUrl, bool ClearLogo, string? FacebookUrl, string? TiktokUrl, string? WhatsappUrl, int TrashRetentionDays);
    private sealed record ProfileAvatarRequest(string DataUrl);
    private sealed record TrashCreateRequest(string? EntityType, Guid EntityId);
    private sealed record BackupCreateRequest(string[]? Scopes);
    private sealed record AdminAuditEventRequest(string ActionCode,string EntityType,Guid? EntityId,JsonElement? Details);
}
