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
    private static void MapBrandingAndProfile(WebApplication app)
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
            await using var cmd = db.CreateCommand("SELECT brand_name,logo_data,logo_content_type,facebook_url,tiktok_url,whatsapp_url,trash_retention_days,updated_at,whatsapp_template_absence,whatsapp_template_unpaid,whatsapp_template_teacher_followup,whatsapp_template_student_followup,teacher_notes_banner,teacher_notes_banner_active FROM school_settings WHERE id=1;");
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return Results.Problem("إعدادات الدار غير مهيأة.");
            return Results.Ok(new AdminSettingsResponse(
                r.GetString(0), r.IsDBNull(1) ? null : $"data:{(r.IsDBNull(2) ? "image/png" : r.GetString(2))};base64,{Convert.ToBase64String((byte[])r[1])}",
                r.IsDBNull(3) ? "" : r.GetString(3), r.IsDBNull(4) ? "" : r.GetString(4), r.IsDBNull(5) ? "" : r.GetString(5),
                r.GetInt32(6), r.GetFieldValue<DateTimeOffset>(7),
                r.GetString(8), r.GetString(9), r.GetString(10), r.GetString(11),
                r.GetString(12), r.GetBoolean(13)));
        }).RequireAuthorization("settings.manage");

        app.MapPut("/api/admin/settings", async Task<IResult> (AdminSettingsWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.BrandName) || request.BrandName.Trim().Length > 200)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["brandName"] = ["اكتب اسم الدار في حدود 200 حرف."] });
            if (request.TrashRetentionDays is < 1 or > 3650)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["trashRetentionDays"] = ["مدة الاحتفاظ يجب أن تكون من يوم إلى 3650 يومًا."] });
            foreach (var (field, url) in new[] { ("facebookUrl", request.FacebookUrl), ("tiktokUrl", request.TiktokUrl), ("whatsappUrl", request.WhatsappUrl) })
                if (!IsSafeHttpsUrl(url)) return Results.ValidationProblem(new Dictionary<string, string[]> { [field] = ["استخدم رابطًا كاملًا يبدأ بـ https:// أو اترك الحقل فارغًا."] });
            foreach (var (field, value, max) in new[]
            {
                ("whatsappTemplateAbsence", request.WhatsappTemplateAbsence, 1000),
                ("whatsappTemplateUnpaid", request.WhatsappTemplateUnpaid, 1000),
                ("whatsappTemplateTeacherFollowup", request.WhatsappTemplateTeacherFollowup, 1000),
                ("whatsappTemplateStudentFollowup", request.WhatsappTemplateStudentFollowup, 1000),
                ("teacherNotesBanner", request.TeacherNotesBanner, 600)
            })
                if (value is not null && value.Length > max)
                    return Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [$"النص يجب ألا يتجاوز {max} حرفًا."] });

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
                  whatsapp_template_absence=COALESCE(@waAbsence,whatsapp_template_absence),
                  whatsapp_template_unpaid=COALESCE(@waUnpaid,whatsapp_template_unpaid),
                  whatsapp_template_teacher_followup=COALESCE(@waTeacher,whatsapp_template_teacher_followup),
                  whatsapp_template_student_followup=COALESCE(@waStudent,whatsapp_template_student_followup),
                  teacher_notes_banner=COALESCE(@notesBanner,teacher_notes_banner),
                  teacher_notes_banner_active=COALESCE(@notesBannerActive,teacher_notes_banner_active),
                  trash_retention_days=@retention,
                  updated_by=@actor,updated_at=now() WHERE id=1;
                """);
            cmd.Parameters.AddWithValue("name", request.BrandName.Trim()); cmd.Parameters.AddWithValue("clearLogo", request.ClearLogo);
            cmd.Parameters.AddWithValue("newLogo", logoBytes is not null); cmd.Parameters.AddWithValue("logo", (object?)logoBytes ?? DBNull.Value);
            cmd.Parameters.AddWithValue("contentType", (object?)logoType ?? DBNull.Value); cmd.Parameters.AddWithValue("facebook", NullIfEmpty(request.FacebookUrl));
            cmd.Parameters.AddWithValue("tiktok", NullIfEmpty(request.TiktokUrl)); cmd.Parameters.AddWithValue("whatsapp", NullIfEmpty(request.WhatsappUrl));
            cmd.Parameters.AddWithValue("waAbsence", NpgsqlDbType.Text, (object?)(request.WhatsappTemplateAbsence?.Trim()) ?? DBNull.Value);
            cmd.Parameters.AddWithValue("waUnpaid", NpgsqlDbType.Text, (object?)(request.WhatsappTemplateUnpaid?.Trim()) ?? DBNull.Value);
            cmd.Parameters.AddWithValue("waTeacher", NpgsqlDbType.Text, (object?)(request.WhatsappTemplateTeacherFollowup?.Trim()) ?? DBNull.Value);
            cmd.Parameters.AddWithValue("waStudent", NpgsqlDbType.Text, (object?)(request.WhatsappTemplateStudentFollowup?.Trim()) ?? DBNull.Value);
            cmd.Parameters.AddWithValue("notesBanner", NpgsqlDbType.Text, (object?)(request.TeacherNotesBanner?.Trim()) ?? DBNull.Value);
            cmd.Parameters.AddWithValue("notesBannerActive", NpgsqlDbType.Boolean, (object?)request.TeacherNotesBannerActive ?? DBNull.Value);
            cmd.Parameters.AddWithValue("retention", request.TrashRetentionDays);
            cmd.Parameters.AddWithValue("actor", DbGuid(ActorId(principal)));
            await cmd.ExecuteNonQueryAsync(ct);
            var settingsAfter = await ReadBrandingAuditSnapshotAsync(db, ct);
            await AuditLogWriter.WriteAsync(db, ActorId(principal),
                principal.FindFirstValue("display_name") ?? "حساب غير معروف",
                "settings.update", "school_settings", null,
                detailsJson: JsonSerializer.Serialize(new { logoChanged = logoBytes is not null || request.ClearLogo, note = "تعديل هوية الدار وسياسات النظام" }),
                beforeJson: settingsBefore, afterJson: settingsAfter,
                requestPath: "/api/admin/settings", httpMethod: "PUT",
                cancellationToken: ct);
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

    }
}
