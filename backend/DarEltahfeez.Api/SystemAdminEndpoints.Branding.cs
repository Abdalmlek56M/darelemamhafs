using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dar.Common.Pagination;
using DarEltahfeez.Api.Media;
using DarEltahfeez.Api.Services;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class SystemAdminEndpoints
{
    private static void MapBrandingAndProfile(WebApplication app)
    {
        app.MapGet("/api/branding", async Task<IResult> (NpgsqlDataSource db, IMediaFileStore media, MediaBackfillService backfill, CancellationToken ct) =>
        {
            string brandName; string? logoFilePath; string? logoContentType; bool hasLegacyLogo;
            string? facebookUrl; string? tiktokUrl; string? whatsappUrl;
            await using (var cmd = db.CreateCommand("SELECT brand_name,logo_file_path,logo_content_type,(logo_data IS NOT NULL),facebook_url,tiktok_url,whatsapp_url FROM school_settings WHERE id=1;"))
            {
                await using var r = await cmd.ExecuteReaderAsync(ct);
                if (!await r.ReadAsync(ct)) return Results.Ok(new BrandingResponse("دار الإمام حفص للقرآن والتجويد", null, null, null, null));
                brandName = r.GetString(0);
                logoFilePath = r.IsDBNull(1) ? null : r.GetString(1);
                logoContentType = r.IsDBNull(2) ? null : r.GetString(2);
                hasLegacyLogo = r.GetBoolean(3);
                facebookUrl = r.IsDBNull(4) ? null : r.GetString(4);
                tiktokUrl = r.IsDBNull(5) ? null : r.GetString(5);
                whatsappUrl = r.IsDBNull(6) ? null : r.GetString(6);
            }
            var logoDataUrl = await ResolveLogoDataUrlAsync(media, backfill, logoFilePath, logoContentType, hasLegacyLogo, ct);
            return Results.Ok(new BrandingResponse(brandName, logoDataUrl, facebookUrl, tiktokUrl, whatsappUrl));
        }).AllowAnonymous();

        app.MapGet("/api/admin/settings", async Task<IResult> (NpgsqlDataSource db, IMediaFileStore media, MediaBackfillService backfill, CancellationToken ct) =>
        {
            string brandName; string? logoFilePath; string? logoContentType; bool hasLegacyLogo;
            string? facebookUrl, tiktokUrl, whatsappUrl; int trashRetentionDays; DateTimeOffset updatedAt;
            string waAbsence, waUnpaid, waTeacher, waStudent, teacherNotesBanner; bool teacherNotesBannerActive;
            await using (var cmd = db.CreateCommand("SELECT brand_name,logo_file_path,logo_content_type,(logo_data IS NOT NULL),facebook_url,tiktok_url,whatsapp_url,trash_retention_days,updated_at,whatsapp_template_absence,whatsapp_template_unpaid,whatsapp_template_teacher_followup,whatsapp_template_student_followup,teacher_notes_banner,teacher_notes_banner_active FROM school_settings WHERE id=1;"))
            {
                await using var r = await cmd.ExecuteReaderAsync(ct);
                if (!await r.ReadAsync(ct)) return Results.Problem("إعدادات الدار غير مهيأة.");
                brandName = r.GetString(0);
                logoFilePath = r.IsDBNull(1) ? null : r.GetString(1);
                logoContentType = r.IsDBNull(2) ? null : r.GetString(2);
                hasLegacyLogo = r.GetBoolean(3);
                facebookUrl = r.IsDBNull(4) ? null : r.GetString(4);
                tiktokUrl = r.IsDBNull(5) ? null : r.GetString(5);
                whatsappUrl = r.IsDBNull(6) ? null : r.GetString(6);
                trashRetentionDays = r.GetInt32(7);
                updatedAt = r.GetFieldValue<DateTimeOffset>(8);
                waAbsence = r.GetString(9); waUnpaid = r.GetString(10); waTeacher = r.GetString(11); waStudent = r.GetString(12);
                teacherNotesBanner = r.GetString(13); teacherNotesBannerActive = r.GetBoolean(14);
            }
            var logoDataUrl = await ResolveLogoDataUrlAsync(media, backfill, logoFilePath, logoContentType, hasLegacyLogo, ct);
            return Results.Ok(new AdminSettingsResponse(
                brandName, logoDataUrl,
                facebookUrl ?? "", tiktokUrl ?? "", whatsappUrl ?? "",
                trashRetentionDays, updatedAt,
                waAbsence, waUnpaid, waTeacher, waStudent, teacherNotesBanner, teacherNotesBannerActive));
        }).RequireAuthorization("settings.manage");

        app.MapPut("/api/admin/settings", async Task<IResult> (AdminSettingsWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, IMediaFileStore media, CancellationToken ct) =>
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
                if (logoBytes.Length > MediaOptions.DefaultMaxLogoBytes) return Results.ValidationProblem(new Dictionary<string, string[]> { ["logoDataUrl"] = ["حجم الشعار يجب ألا يتجاوز 2 ميجابايت."] });
                logoType = match.Groups[1].Value.ToLowerInvariant();
            }

            MediaFileWriteResult? storedLogo = null;
            if (logoBytes is not null && logoType is not null)
            {
                try { storedLogo = await media.SaveLogoAsync(logoBytes, logoType, ct); }
                catch (MediaSizeLimitExceededException) { return Results.ValidationProblem(new Dictionary<string, string[]> { ["logoDataUrl"] = ["حجم الشعار يجب ألا يتجاوز 2 ميجابايت."] }); }
            }

            var settingsBefore = await ReadBrandingAuditSnapshotAsync(db, ct);
            await using var cmd = db.CreateCommand("""
                UPDATE school_settings SET brand_name=@name,
                  logo_data=CASE WHEN @clearLogo THEN NULL ELSE logo_data END,
                  logo_file_path=CASE WHEN @clearLogo THEN NULL WHEN @newLogo THEN @path ELSE logo_file_path END,
                  logo_size_bytes=CASE WHEN @clearLogo THEN NULL WHEN @newLogo THEN @size ELSE logo_size_bytes END,
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
            cmd.Parameters.AddWithValue("newLogo", storedLogo is not null);
            // Explicit types keep the CASE expressions typed even when a parameter is DBNull.
            var logoPathParameter = cmd.Parameters.Add("path", NpgsqlDbType.Text);
            logoPathParameter.Value = (object?)storedLogo?.RelativePath ?? DBNull.Value;
            var logoSizeParameter = cmd.Parameters.Add("size", NpgsqlDbType.Bigint);
            logoSizeParameter.Value = (object?)storedLogo?.SizeBytes ?? DBNull.Value;
            var logoTypeParameter = cmd.Parameters.Add("contentType", NpgsqlDbType.Text);
            logoTypeParameter.Value = (object?)storedLogo?.ContentType ?? DBNull.Value;
            cmd.Parameters.AddWithValue("facebook", NullIfEmpty(request.FacebookUrl));
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
                detailsJson: JsonSerializer.Serialize(new { logoChanged = storedLogo is not null || request.ClearLogo, note = "تعديل هوية الدار وسياسات النظام" }),
                beforeJson: settingsBefore, afterJson: settingsAfter,
                requestPath: "/api/admin/settings", httpMethod: "PUT",
                cancellationToken: ct);
            return Results.Ok(new { saved = true, message = "تم حفظ إعدادات الدار." });
        }).RequireAuthorization("settings.manage");

        app.MapGet("/api/auth/profile/avatar", async Task<IResult> (ClaimsPrincipal principal, NpgsqlDataSource db, IMediaFileStore media, MediaBackfillService backfill, CancellationToken ct) =>
        {
            if (ActorId(principal) is not Guid id) return Results.Unauthorized();
            string? filePath; string? contentType; bool hasLegacyAvatar;
            await using (var cmd = db.CreateCommand("SELECT avatar_file_path,avatar_content_type,(avatar_data IS NOT NULL) FROM app_users WHERE id=@id AND is_active=TRUE;"))
            {
                cmd.Parameters.AddWithValue("id", id);
                await using var r = await cmd.ExecuteReaderAsync(ct);
                if (!await r.ReadAsync(ct)) return Results.NotFound();
                filePath = r.IsDBNull(0) ? null : r.GetString(0);
                contentType = r.IsDBNull(1) ? null : r.GetString(1);
                hasLegacyAvatar = r.GetBoolean(2);
            }
            var bytes = filePath is null ? null : await media.ReadAsync(filePath, ct);
            if (bytes is null && hasLegacyAvatar)
            {
                var migrated = filePath is null
                    ? await backfill.MigrateAvatarAsync(id, ct)
                    : await backfill.RepairAvatarFileAsync(id, ct);
                if (migrated is not null) { bytes = migrated.Content; contentType ??= migrated.ContentType; }
            }
            if (bytes is null) return Results.NotFound();
            return Results.File(bytes, contentType ?? MediaContentTypes.Png, enableRangeProcessing: false);
        }).RequireAuthorization();

        app.MapPut("/api/auth/profile/avatar", async Task<IResult> (ProfileAvatarRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, IMediaFileStore media, CancellationToken ct) =>
        {
            if (ActorId(principal) is not Guid id) return Results.Unauthorized();
            var match = Regex.Match(request.DataUrl ?? "", @"^data:(image/png|image/jpeg|image/webp);base64,([A-Za-z0-9+/=]+)$", RegexOptions.IgnoreCase);
            if (!match.Success) return Results.ValidationProblem(new Dictionary<string, string[]> { ["dataUrl"] = ["اختر صورة PNG أو JPG أو WebP."] });
            byte[] bytes; try { bytes = Convert.FromBase64String(match.Groups[2].Value); } catch (FormatException) { return Results.BadRequest(new { message = "الصورة غير صالحة." }); }
            if (bytes.Length > MediaOptions.DefaultMaxAvatarBytes) return Results.BadRequest(new { message = "حجم الصورة يجب ألا يتجاوز 2 ميجابايت." });
            MediaFileWriteResult storedAvatar;
            try { storedAvatar = await media.SaveAvatarAsync(bytes, match.Groups[1].Value.ToLowerInvariant(), ct); }
            catch (MediaSizeLimitExceededException) { return Results.BadRequest(new { message = "حجم الصورة يجب ألا يتجاوز 2 ميجابايت." }); }
            await using var cmd = db.CreateCommand("UPDATE app_users SET avatar_file_path=@path,avatar_size_bytes=@size,avatar_content_type=@type,updated_at=now() WHERE id=@id AND is_active=TRUE;");
            cmd.Parameters.AddWithValue("path", storedAvatar.RelativePath);
            cmd.Parameters.AddWithValue("size", storedAvatar.SizeBytes);
            cmd.Parameters.AddWithValue("type", storedAvatar.ContentType);
            cmd.Parameters.AddWithValue("id", id);
            if (await cmd.ExecuteNonQueryAsync(ct) == 0) return Results.NotFound();
            await InsertAuditAsync(db, id, principal.FindFirstValue("display_name"), "profile.avatar.update", "app_users", id, null, JsonSerializer.Serialize(new { avatarUpdated = true }), "/api/auth/profile/avatar", "PUT", false, ct);
            return Results.Ok(new { saved = true });
        }).RequireAuthorization();
    }

    /// <summary>
    /// Tier 2.5 dual read for the branding logo. Returns the exact same data: URL contract as
    /// before: path/file first, then a lazy migration of the legacy BYTEA, then null.
    /// </summary>
    private static async Task<string?> ResolveLogoDataUrlAsync(
        IMediaFileStore media, MediaBackfillService backfill,
        string? filePath, string? contentType, bool hasLegacyBytes, CancellationToken ct)
    {
        var effectiveContentType = contentType ?? MediaContentTypes.Png;
        if (filePath is not null)
        {
            var fileBytes = await media.ReadAsync(filePath, ct);
            if (fileBytes is not null) return ToDataUrl(fileBytes, effectiveContentType);
            if (!hasLegacyBytes) return null;
            // Path recorded but the derived file vanished: re-materialise it from the legacy BYTEA.
            var repaired = await backfill.RepairLogoFileAsync(ct);
            return repaired is null ? null : ToDataUrl(repaired.Content, contentType ?? repaired.ContentType);
        }
        if (!hasLegacyBytes) return null;
        var migrated = await backfill.MigrateLogoAsync(ct);
        if (migrated is null) return null;
        return ToDataUrl(migrated.Content, contentType ?? migrated.ContentType);
    }

    private static string ToDataUrl(byte[] content, string contentType) =>
        $"data:{contentType};base64,{Convert.ToBase64String(content)}";
}
