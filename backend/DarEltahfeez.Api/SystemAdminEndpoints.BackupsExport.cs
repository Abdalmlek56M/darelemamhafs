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
    private static void MapBackupsAndExport(WebApplication app)
    {
        app.MapGet("/api/admin/backups", async Task<IResult> (int? page, int? pageSize, HttpContext http, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var paging = new PageRequest(page, pageSize);
            var paged = page is not null || pageSize is not null;
            var take = paged ? paging.PageSize : 100;
            await using var cmd = db.CreateCommand("SELECT id,backup_file_name,scope_codes,backup_format,status,file_size_bytes,started_at,completed_at,created_by_name,error_message,COUNT(*) OVER() AS total FROM system_backups ORDER BY started_at DESC,id DESC LIMIT @take OFFSET @skip;");
            cmd.Parameters.AddWithValue("take", take);
            cmd.Parameters.AddWithValue("skip", paged ? paging.Offset : 0L);
            var rows = new List<object>(); long total = 0;
            await using (var r = await cmd.ExecuteReaderAsync(ct))
            {
                while (await r.ReadAsync(ct))
                {
                    total = r.ReadTotal();
                    rows.Add(new { id = r.GetGuid(0), fileName = r.GetString(1), scopes = r.GetString(2), format = r.GetString(3), status = r.GetString(4), sizeBytes = r.IsDBNull(5) ? (long?)null : r.GetInt64(5), startedAt = r.GetFieldValue<DateTimeOffset>(6), completedAt = r.IsDBNull(7) ? (DateTimeOffset?)null : r.GetFieldValue<DateTimeOffset>(7), createdByName = r.IsDBNull(8) ? "نسخ احتياطي تلقائي" : r.GetString(8), errorMessage = r.IsDBNull(9) ? null : r.GetString(9) });
                }
            }
            total = await PaginationRules.EnsureTotalAsync(cmd, total, paged, ct);
            PaginationHeaderWriter.Write(http.Response, total, paging, rows.Count, paged);
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
            catch (ArgumentException ex)
            {
                app.Logger.LogWarning(ex, "Invalid backup scopes request.");
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["scopes"] = ["نطاق النسخة الاحتياطية غير صالح. راجع الخيارات المحددة وحاول مرة أخرى."] });
            }
            catch (Exception ex)
            {
                app.Logger.LogError(ex, "Backup creation failed.");
                return Results.Problem(title: "تعذر إنشاء النسخة الاحتياطية", detail: "حدث خطأ مؤقت في الخادم. حاول مرة أخرى.", statusCode: 500);
            }
        }).RequireAuthorization("backup.manage");

        app.MapGet("/api/admin/backups/{id:guid}/download", async Task<IResult> (Guid id, NpgsqlDataSource db, SystemAdminService service, CancellationToken ct) =>
        {
            await using var cmd = db.CreateCommand("SELECT backup_file_name,backup_path FROM system_backups WHERE id=@id AND status='completed';"); cmd.Parameters.AddWithValue("id", id);
            await using var r = await cmd.ExecuteReaderAsync(ct); if (!await r.ReadAsync(ct)) return Results.NotFound();
            var fileName = Path.GetFileName(r.GetString(0)); var path = Path.GetFullPath(r.GetString(1));
            var root = Path.GetFullPath(service.BackupRootPath) + Path.DirectorySeparatorChar;
            if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(path)) return Results.NotFound(new { message = "ملف النسخة الاحتياطية غير موجود في مجلد النسخ المعتمد." });
            return Results.File(path, "application/octet-stream", fileName, enableRangeProcessing: true);
        }).RequireAuthorization("backup.manage");

        app.MapGet("/api/admin/export", async Task<IResult> (string? scopes, string? entityType, Guid? entityId, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var financeVisible = CanReadFinance(principal);
            string[] tables; try { tables = SystemAdminService.TablesForExport((scopes ?? "all").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)); }
            catch (ArgumentException ex)
            {
                app.Logger.LogWarning(ex, "Invalid export scopes request.");
                return Results.BadRequest(new { message = "نطاق التصدير غير صالح. راجع الخيارات المحددة وحاول مرة أخرى." });
            }
            if (entityId.HasValue && entityType is null) return Results.BadRequest(new { message = "حدد نوع السجل عند تصدير سجل بعينه." });
            if (entityType is not null && !new[] { "student", "teacher", "circle" }.Contains(entityType, StringComparer.Ordinal)) return Results.BadRequest(new { message = "نوع التصدير التفصيلي غير مدعوم." });
            if (entityType is not null) tables = SystemAdminService.TablesForEntityExport(entityType);
            // Tier 2.7: build every export section as one jsonb document inside a single command
            // instead of one round trip per table (the student/teacher/circle exports used to
            // run 9-12 sequential SELECTs plus the brand lookup). The section values are the
            // exact same aggregations, so the response shape is unchanged; the only semantic
            // difference is that all sections now come from one MVCC snapshot instead of one
            // snapshot per table.
            var select = new System.Text.StringBuilder("SELECT jsonb_build_object(");
            for (var index = 0; index < tables.Length; index++)
            {
                var table = tables[index];
                var predicate = entityType is null ? "TRUE" : entityId.HasValue ? ExportEntityPredicate(table, entityType) : ExportEntityFamilyPredicate(table, entityType);
                if (index > 0) select.Append(',');
                select.Append('\'').Append(table).Append("', ").Append(ExportSectionJsonSubquery(table, predicate));
            }
            select.Append(")::text, (SELECT brand_name FROM school_settings WHERE id=1);");
            await using var cmd = db.CreateCommand(select.ToString());
            if (entityId.HasValue) cmd.Parameters.AddWithValue("entityId", entityId.Value);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            var brand = reader.IsDBNull(1) ? "دار الإمام حفص للقرآن والتجويد" : reader.GetString(1);
            using var document = JsonDocument.Parse(reader.GetString(0));
            var sections = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            foreach (var table in tables)
            {
                var tableJson = document.RootElement.TryGetProperty(table, out var section) ? section.GetRawText() : "[]";
                // app_users never carried financial columns, so it keeps the old plain parse path.
                sections[table] = table == "app_users"
                    ? ParseJson(tableJson) ?? JsonDocument.Parse("[]").RootElement.Clone()
                    : (financeVisible ? ParseJson(tableJson) : ParseJsonForFinance(tableJson, false)) ?? JsonDocument.Parse("[]").RootElement.Clone();
            }
            return Results.Ok(new { schoolName = brand, generatedAt = DateTimeOffset.UtcNow, scope = scopes ?? "all", entityType, entityId, sections });
        }).RequireAuthorization("exports.manage");
    }
}
