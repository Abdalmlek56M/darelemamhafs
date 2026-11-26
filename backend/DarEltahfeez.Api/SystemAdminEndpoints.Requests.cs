using System.Security.Claims;
using System.Text.Json;
using Dar.Common.Pagination;
using Dar.Common.Requests;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class SystemAdminEndpoints
{
    internal static void MapRequests(WebApplication app)
    {
        MapPagedResetCandidates(app);
        app.MapGet("/api/admin/requests", async Task<IResult> (string? status, int? page, int? pageSize, HttpContext http, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var filter = string.IsNullOrWhiteSpace(status) ? "pending" : status.Trim().ToLowerInvariant();
            if (filter is not ("pending" or "approved" or "rejected" or "cancelled" or "all"))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["status"] = ["حالة غير صحيحة."] });
            var paging = new PageRequest(page, pageSize);
            var paged = page is not null || pageSize is not null;
            var take = paged ? paging.PageSize : 250;

            var rows = new List<object>();
            long total = 0;
            await using var connection = await db.OpenConnectionAsync(ct);
            await using (var command = new NpgsqlCommand("""
                SELECT r.id, r.request_type, t.full_name, r.teacher_id, c.name, r.circle_id,
                       r.request_date, r.reason, r.status, r.created_at, r.requested_payload::text,
                       r.review_note, r.reviewed_at, ta.id, COUNT(*) OVER() AS total
                FROM attendance_requests r
                JOIN teachers t ON t.id=r.teacher_id
                JOIN circles c ON c.id=r.circle_id
                LEFT JOIN teacher_attendance ta ON ta.id=r.attendance_id
                WHERE r.is_trashed=FALSE AND (@status='all' OR r.status=@status)
                ORDER BY (r.status='pending') DESC, r.created_at DESC, r.id
                LIMIT @take OFFSET @skip;
                """, connection))
            {
                command.Parameters.AddWithValue("status", filter);
                command.Parameters.AddWithValue("take", take);
                command.Parameters.AddWithValue("skip", paged ? paging.Offset : 0L);
                await using (var reader = await command.ExecuteReaderAsync(ct))
                {
                    while (await reader.ReadAsync(ct))
                    {
                        total = reader.ReadTotal();
                        rows.Add(new
                        {
                            id = reader.GetGuid(0),
                            type = reader.GetString(1),
                            teacherName = reader.GetString(2),
                            teacherId = reader.GetGuid(3),
                            circleName = reader.GetString(4),
                            circleId = reader.GetGuid(5),
                            date = reader.IsDBNull(6) ? (DateOnly?)null : reader.GetFieldValue<DateOnly>(6),
                            reason = reader.GetString(7),
                            status = reader.GetString(8),
                            createdAt = reader.GetFieldValue<DateTimeOffset>(9),
                            payload = reader.IsDBNull(10) ? null : reader.GetString(10),
                            reviewNote = reader.IsDBNull(11) ? null : reader.GetString(11),
                            reviewedAt = reader.IsDBNull(12) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(12),
                            attendanceId = reader.IsDBNull(13) ? (Guid?)null : reader.GetGuid(13)
                        });
                    }
                }
                total = await PaginationRules.EnsureTotalAsync(command, total, paged, ct);
            }
            PaginationHeaderWriter.Write(http.Response, total, paging, rows.Count, paged);
            return Results.Ok(new { count = rows.Count, requests = rows });
        }).RequireAuthorization("attendance.edit").AddEndpointFilter<ScopedAccessEndpointFilter>();

        app.MapPost("/api/admin/requests/{id:guid}/review", async Task<IResult> (Guid id, AdminReviewRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
            if (note is { Length: > 2000 })
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["note"] = ["الملاحظة طويلة جدًا."] });

            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            var actor = (Guid)DbGuid(ActorId(principal));
            var result = await RequestReviewService.ReviewAsync(
                connection, transaction, id, request.Approve, note, actor, null, ct);

            if (result.Outcome != RequestReviewOutcome.Ok)
            {
                await transaction.RollbackAsync(ct);
                return result.Outcome switch
                {
                    RequestReviewOutcome.NotFound => Results.NotFound(new { message = "الطلب غير موجود." }),
                    RequestReviewOutcome.Forbidden => Results.Json(new { message = "هذا الطلب خارج نطاقك." },
                        statusCode: StatusCodes.Status403Forbidden),
                    RequestReviewOutcome.AlreadyReviewed => Results.Conflict(
                        new { message = "تمت مراجعة هذا الطلب بالفعل." }),
                    RequestReviewOutcome.MissingSchedule => Results.ValidationProblem(
                        new Dictionary<string, string[]> { ["request"] = ["بيانات الموعد ناقصة."] }),
                    RequestReviewOutcome.MissingAttendance => Results.ValidationProblem(
                        new Dictionary<string, string[]> { ["request"] = ["سجل الحضور غير موجود."] }),
                    RequestReviewOutcome.InvalidDuration => Results.ValidationProblem(
                        new Dictionary<string, string[]> { ["durationMinutes"] = ["المدة المقترحة غير صحيحة."] }),
                    RequestReviewOutcome.InvalidStatus => Results.ValidationProblem(
                        new Dictionary<string, string[]> { ["status"] = ["حالة الحضور المقترحة غير صحيحة."] }),
                    RequestReviewOutcome.InvalidAmount => Results.ValidationProblem(
                        new Dictionary<string, string[]> { ["amount"] = ["تعذر حساب الأجر."] }),
                    RequestReviewOutcome.Locked => Results.Conflict(new { message =
                        "مسير رواتب هذا الشهر مقفل. افتح المسير قبل اعتماد الطلب." }),
                    _ => Results.Problem()
                };
            }

            if (result.Type == "correction" && result.Correction is { } correction)
                await InsertRequestAuditAsync(connection, transaction, ActorId(principal),
                    principal.FindFirstValue("display_name"), "request.correction.apply",
                    "teacher_attendance", result.AttendanceId,
                    JsonSerializer.Serialize(new {
                        oldDuration = correction.OldDuration,
                        oldStatus = correction.OldStatus,
                        newDuration = correction.NewDuration,
                        newStatus = correction.NewStatus,
                        amount = correction.Amount
                    }), id, ct);

            await using (var resolveNotification = new NpgsqlCommand("""
                UPDATE notifications
                SET status='resolved', resolved_at=now(), resolved_by=@actor, resolution_note=@note
                WHERE dedupe_key='request:' || @id AND status='open';
                """, connection, transaction))
            {
                resolveNotification.Parameters.AddWithValue("actor", DbGuid(ActorId(principal)));
                resolveNotification.Parameters.AddWithValue("note",
                    request.Approve ? "تم اعتماد الطلب." : "تم رفض الطلب.");
                resolveNotification.Parameters.AddWithValue("id", id);
                await resolveNotification.ExecuteNonQueryAsync(ct);
            }

            await NotifyTeacherAsync(connection, transaction, result.TeacherId, id,
                request.Approve ? "تم اعتماد طلبك" : "تم رفض طلبك",
                request.Approve ? "تمت مراجعة الطلب واعتماده."
                    : $"تم رفض الطلب. {note ?? string.Empty}".Trim(), ct);

            await InsertRequestAuditAsync(connection, transaction, ActorId(principal),
                principal.FindFirstValue("display_name"), "request.review", "attendance_request", id,
                JsonSerializer.Serialize(new { approved = request.Approve, note, type = result.Type }), id, ct);
            await transaction.CommitAsync(ct);
            return Results.Ok(new { id, status = result.Status });
        }).RequireAuthorization("attendance.edit").AddEndpointFilter<ScopedAccessEndpointFilter>();

        app.MapPost("/api/admin/requests/{id:guid}/reopen", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            string status;
            string? effectBefore, effectAfter;
            Guid teacherId, circleId;
            await using (var read = new NpgsqlCommand("""
                SELECT status,COALESCE(effect_before::text,''),COALESCE(effect_after::text,''),teacher_id,circle_id
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
            }
            if (!RequestWorkflow.CanReopen(status))
            {
                await transaction.RollbackAsync(ct);
                return Results.Conflict(new { message = "لا يمكن إعادة هذا الطلب للمراجعة إلا بعد اعتماده." });
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

    private static async Task RestoreEffectAsync(NpgsqlConnection connection, NpgsqlTransaction transaction,
        string? beforeJson, string? afterJson, CancellationToken ct)
    {
        JsonElement before = default;
        JsonElement after = default;
        if (!string.IsNullOrWhiteSpace(beforeJson))
            using (var document = JsonDocument.Parse(beforeJson)) before = document.RootElement.Clone();
        if (!string.IsNullOrWhiteSpace(afterJson))
            using (var document = JsonDocument.Parse(afterJson)) after = document.RootElement.Clone();

        if (before.ValueKind == JsonValueKind.Object && before.TryGetProperty("attendance", out var beforeAttendance) && beforeAttendance.ValueKind == JsonValueKind.Object)
        {
            var id = beforeAttendance.GetProperty("id").GetGuid();
            await using var restore = new NpgsqlCommand("""
                UPDATE teacher_attendance ta SET
                    teacher_id=b.teacher_id,hourly_rate_snapshot=b.hourly_rate_snapshot,status=b.status,
                    duration_minutes=b.duration_minutes,payable_amount=b.payable_amount,note=b.note,
                    marked_by=b.marked_by,marked_at=b.marked_at,actual_duration_minutes=b.actual_duration_minutes,
                    pay_basis=b.pay_basis,overtime_minutes=b.overtime_minutes,undertime_minutes=b.undertime_minutes,
                    is_trashed=b.is_trashed
                FROM jsonb_populate_record(NULL::teacher_attendance, @json::jsonb) b
                WHERE ta.id=@id;
                """, connection, transaction);
            restore.Parameters.AddWithValue("json", beforeAttendance.GetRawText());
            restore.Parameters.AddWithValue("id", id);
            await restore.ExecuteNonQueryAsync(ct);
        }
        else if (after.ValueKind == JsonValueKind.Object && after.TryGetProperty("attendance", out var afterAttendance) && afterAttendance.ValueKind == JsonValueKind.Object)
        {
            var id = afterAttendance.GetProperty("id").GetGuid();
            await using var hide = new NpgsqlCommand("UPDATE teacher_attendance SET is_trashed=TRUE WHERE id=@id;", connection, transaction);
            hide.Parameters.AddWithValue("id", id);
            await hide.ExecuteNonQueryAsync(ct);
        }

        if (before.ValueKind == JsonValueKind.Object && before.TryGetProperty("session", out var beforeSession) && beforeSession.ValueKind == JsonValueKind.Object)
        {
            var id = beforeSession.GetProperty("id").GetGuid();
            await using var restore = new NpgsqlCommand("""
                UPDATE teacher_sessions ts SET
                    status=b.status,actual_duration_minutes=b.actual_duration_minutes,
                    payable_duration_minutes=b.payable_duration_minutes,pay_basis=b.pay_basis,
                    overtime_minutes=b.overtime_minutes,undertime_minutes=b.undertime_minutes,
                    note=b.note,updated_at=now()
                FROM jsonb_populate_record(NULL::teacher_sessions, @json::jsonb) b
                WHERE ts.id=@id;
                """, connection, transaction);
            restore.Parameters.AddWithValue("json", beforeSession.GetRawText());
            restore.Parameters.AddWithValue("id", id);
            await restore.ExecuteNonQueryAsync(ct);
        }
    }

    private static async Task NotifyTeacherAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, Guid teacherId,
        Guid requestId, string title, string body, CancellationToken ct)
    {
        Guid? userId = null;
        await using (var user = new NpgsqlCommand("""
            SELECT id FROM app_users WHERE teacher_id=@teacher AND is_active=TRUE AND is_locked=FALSE LIMIT 1;
            """, connection, transaction))
        {
            user.Parameters.AddWithValue("teacher", teacherId);
            userId = await user.ExecuteScalarAsync(ct) as Guid?;
        }
        if (userId is null) return;
        await using var command = new NpgsqlCommand("""
            INSERT INTO notifications(user_id,role_scope,category,status,severity,title,body,entity_type,entity_id,action_url,dedupe_key)
            VALUES(@user,'teacher','attendance','open','info',@title,@body,'attendance_request',@id,'/teacher/requests',@dedupe)
            ON CONFLICT(dedupe_key) DO UPDATE SET status='open',resolved_at=NULL,resolved_by=NULL,resolution_note=NULL,title=EXCLUDED.title,body=EXCLUDED.body;
            """, connection, transaction);
        command.Parameters.AddWithValue("user", userId.Value);
        command.Parameters.AddWithValue("title", title);
        command.Parameters.AddWithValue("body", body);
        command.Parameters.AddWithValue("id", requestId);
        command.Parameters.AddWithValue("dedupe", $"request-review:{requestId}");
        await command.ExecuteNonQueryAsync(ct);
    }

    private static async Task InsertRequestAuditAsync(NpgsqlConnection connection, NpgsqlTransaction transaction,
        Guid? actor, string? actorName, string action, string entityType, Guid entityId, string details, Guid requestId, CancellationToken ct)
    {
        await using var audit = new NpgsqlCommand("""
            INSERT INTO audit_log(actor_user_id,actor_display_name,action_code,entity_type,entity_id,details,request_path,http_method,can_restore)
            VALUES(@actor,@name,@action,@type,@id,@details::jsonb,@path,'POST',FALSE);
            """, connection, transaction);
        audit.Parameters.AddWithValue("actor", DbGuid(actor));
        audit.Parameters.AddWithValue("name", (object?)actorName ?? DBNull.Value);
        audit.Parameters.AddWithValue("action", action);
        audit.Parameters.AddWithValue("type", entityType);
        audit.Parameters.AddWithValue("id", entityId);
        audit.Parameters.AddWithValue("details", details);
        audit.Parameters.AddWithValue("path", $"/api/admin/requests/{requestId}/review");
        await audit.ExecuteNonQueryAsync(ct);
    }
}

public sealed record AdminReviewRequest(bool Approve, string? Note);
public sealed record AdminRequestEditRequest(string? Reason, DateOnly? Date, string? Payload);
