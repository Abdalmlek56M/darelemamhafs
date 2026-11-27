using System.Security.Claims;
using Dar.Common.Requests;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dar.Common.Pagination;
using DarEltahfeez.Api.Services;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class SystemAdminEndpoints
{
    private static void MapRequestEdit(WebApplication app)
    {
        app.MapPost("/api/admin/requests/{id:guid}/reopen", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            string status;
            string? effectBefore, effectAfter;
            Guid teacherId, circleId;
            DateOnly? requestDate;
            await using (var read = new NpgsqlCommand("""
                SELECT status,COALESCE(effect_before::text,''),COALESCE(effect_after::text,''),teacher_id,circle_id,request_date
                FROM attendance_requests WHERE id=@id AND is_trashed=FALSE FOR UPDATE;
                """, connection, transaction))
            {
                read.Parameters.AddWithValue("id", id);
                await using var reader = await read.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct))
                {
                    await transaction.RollbackAsync(ct);
                    return Results.NotFound(new { message = "الطلب غير موجود." });
                }
                status = reader.GetString(0);
                effectBefore = string.IsNullOrWhiteSpace(reader.GetString(1)) ? null : reader.GetString(1);
                effectAfter = string.IsNullOrWhiteSpace(reader.GetString(2)) ? null : reader.GetString(2);
                teacherId = reader.GetGuid(3);
                circleId = reader.GetGuid(4);
                requestDate = reader.IsDBNull(5) ? null : reader.GetFieldValue<DateOnly>(5);
            }
            if (!RequestWorkflow.CanReopen(status))
            {
                await transaction.RollbackAsync(ct);
                return Results.Conflict(new { message = "لا يمكن إعادة هذا الطلب للمراجعة إلا بعد اعتماده." });
            }
            // P0-8: reopening an approved request restores attendance, so a locked payroll month must block it.
            if (requestDate is not null)
            {
                var locked = false;
                await using (var lockCheck = new NpgsqlCommand("""
                    SELECT EXISTS(SELECT 1 FROM payroll_locks
                                  WHERE billing_month=date_trunc('month',@date::date)::date AND is_locked=TRUE);
                    """, connection, transaction))
                {
                    lockCheck.Parameters.AddWithValue("date", requestDate.Value);
                    locked = (bool)(await lockCheck.ExecuteScalarAsync(ct) ?? false);
                }
                if (locked)
                {
                    await transaction.RollbackAsync(ct);
                    return Results.Conflict(new { message = "شهر الحضور مقفل للرواتب. افتح قفل الرواتب قبل إعادة الطلب للمراجعة." });
                }
            }

            await RestoreEffectAsync(connection, transaction, effectBefore, effectAfter, ct);
            await using (var update = new NpgsqlCommand("""
                UPDATE attendance_requests SET status='pending',reviewed_by=NULL,reviewed_at=NULL,review_note=NULL,
                    effect_before=NULL,effect_after=NULL,updated_at=now()
                WHERE id=@id;
                """, connection, transaction))
            {
                update.Parameters.AddWithValue("id", id);
                await update.ExecuteNonQueryAsync(ct);
            }
            // P1-5: reopen the supervisor notification for the pending request.
            await using (var reopenNotification = new NpgsqlCommand("""
                INSERT INTO notifications(user_id,role_scope,category,status,severity,title,body,entity_type,entity_id,action_url,dedupe_key,scope_circle_id,scope_teacher_id)
                VALUES(NULL,'supervisor','attendance','open','info','طلب معاد للمراجعة','تم إرجاع الطلب إلى قائمة المراجعة.','attendance_request',@id,'/supervisor/requests','request:' || @id,@circle,@teacher)
                ON CONFLICT(dedupe_key) DO UPDATE SET status='open',resolved_at=NULL,resolved_by=NULL,resolution_note=NULL,title=EXCLUDED.title,body=EXCLUDED.body,action_url=EXCLUDED.action_url,scope_circle_id=EXCLUDED.scope_circle_id,scope_teacher_id=EXCLUDED.scope_teacher_id;
                """, connection, transaction))
            {
                reopenNotification.Parameters.AddWithValue("id", id);
                reopenNotification.Parameters.AddWithValue("circle", circleId);
                reopenNotification.Parameters.AddWithValue("teacher", teacherId);
                await reopenNotification.ExecuteNonQueryAsync(ct);
            }
            await NotifyTeacherAsync(connection, transaction, teacherId, id, "أُعيد طلبك للمراجعة",
                "تم إرجاع الطلب إلى قائمة المراجعة بعد عكس أثره السابق.", ct);
            await InsertRequestAuditAsync(connection, transaction, ActorId(principal), principal.FindFirstValue("display_name"),
                "request.reopen", "attendance_request", id, JsonSerializer.Serialize(new { status }), id, ct);
            await transaction.CommitAsync(ct);
            return Results.Ok(new { id, status = "pending" });
        }).RequireAuthorization("users.manage").AddEndpointFilter<ScopedAccessEndpointFilter>();

        app.MapPut("/api/admin/requests/{id:guid}", async Task<IResult> (Guid id, AdminRequestEditRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Reason) || request.Reason.Trim().Length < 3)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["reason"] = ["اكتب سبب الطلب (3 أحرف على الأقل)."] });
            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            string status;
            await using (var read = new NpgsqlCommand("SELECT status FROM attendance_requests WHERE id=@id AND is_trashed=FALSE FOR UPDATE;", connection, transaction))
            {
                read.Parameters.AddWithValue("id", id);
                var value = await read.ExecuteScalarAsync(ct);
                if (value is null)
                {
                    await transaction.RollbackAsync(ct);
                    return Results.NotFound(new { message = "الطلب غير موجود." });
                }
                status = (string)value;
            }
            if (!RequestWorkflow.CanEdit(status))
            {
                await transaction.RollbackAsync(ct);
                return Results.Conflict(new { message = "لا يمكن تعديل الطلب بعد مراجعته. أعده للمراجعة أولًا إذا كان معتمدًا." });
            }
            await using (var update = new NpgsqlCommand("""
                UPDATE attendance_requests SET reason=@reason,request_date=@date,requested_payload=@payload::jsonb,updated_at=now()
                WHERE id=@id;
                """, connection, transaction))
            {
                update.Parameters.AddWithValue("id", id);
                update.Parameters.AddWithValue("reason", request.Reason.Trim());
                update.Parameters.AddWithValue("date", (object?)request.Date ?? DBNull.Value);
                update.Parameters.AddWithValue("payload", (object?)request.Payload ?? DBNull.Value);
                await update.ExecuteNonQueryAsync(ct);
            }
            await InsertRequestAuditAsync(connection, transaction, ActorId(principal), principal.FindFirstValue("display_name"),
                "request.update", "attendance_request", id, JsonSerializer.Serialize(new { reason = request.Reason.Trim(), date = request.Date }), id, ct);
            await transaction.CommitAsync(ct);
            return Results.Ok(new { id, status = "pending" });
        }).RequireAuthorization("attendance.edit").AddEndpointFilter<ScopedAccessEndpointFilter>();

        app.MapPost("/api/admin/requests/{id:guid}/delete", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            string? status;
            await using (var read = new NpgsqlCommand("SELECT status FROM attendance_requests WHERE id=@id AND is_trashed=FALSE FOR UPDATE;", connection, transaction))
            {
                read.Parameters.AddWithValue("id", id);
                status = await read.ExecuteScalarAsync(ct) as string;
            }
            if (status is null)
            {
                await transaction.RollbackAsync(ct);
                return Results.NotFound(new { message = "الطلب غير موجود." });
            }
            if (!RequestWorkflow.CanDelete(status))
            {
                await transaction.RollbackAsync(ct);
                return Results.Conflict(new { message = "أعد الطلب المعتمد للمراجعة أولًا قبل حذفه." });
            }
            await using (var update = new NpgsqlCommand("UPDATE attendance_requests SET is_trashed=TRUE,updated_at=now() WHERE id=@id;", connection, transaction))
            {
                update.Parameters.AddWithValue("id", id);
                await update.ExecuteNonQueryAsync(ct);
            }
            // P1-5: a deleted request must not leave an open supervisor notification.
            await using (var closeNotification = new NpgsqlCommand("""
                UPDATE notifications SET status='resolved',resolved_at=now(),resolved_by=@actor,resolution_note='تم حذف الطلب.'
                WHERE dedupe_key='request:' || @id AND status='open';
                """, connection, transaction))
            {
                closeNotification.Parameters.AddWithValue("actor", DbGuid(ActorId(principal)));
                closeNotification.Parameters.AddWithValue("id", id);
                await closeNotification.ExecuteNonQueryAsync(ct);
            }
            await InsertRequestAuditAsync(connection, transaction, ActorId(principal), principal.FindFirstValue("display_name"),
                "request.delete", "attendance_request", id, JsonSerializer.Serialize(new { previousStatus = status }), id, ct);
            await transaction.CommitAsync(ct);
            return Results.Ok(new { id, deleted = true });
        }).RequireAuthorization("users.manage").AddEndpointFilter<ScopedAccessEndpointFilter>();
    }
}
