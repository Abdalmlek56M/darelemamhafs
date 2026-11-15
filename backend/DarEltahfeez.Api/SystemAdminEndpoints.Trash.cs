using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using DarEltahfeez.Api.Services;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class SystemAdminEndpoints
{
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

}
