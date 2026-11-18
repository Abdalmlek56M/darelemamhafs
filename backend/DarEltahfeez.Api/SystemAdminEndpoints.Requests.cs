using System.Security.Claims;
using System.Text.Json;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class SystemAdminEndpoints
{
    internal static void MapRequests(WebApplication app)
    {
        app.MapGet("/api/admin/requests", async Task<IResult> (string? status, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var filter = string.IsNullOrWhiteSpace(status) ? "pending" : status.Trim().ToLowerInvariant();
            if (filter is not ("pending" or "approved" or "rejected" or "cancelled" or "all"))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["status"] = ["حالة غير صحيحة."] });

            var rows = new List<object>();
            await using var connection = await db.OpenConnectionAsync(ct);
            await using (var command = new NpgsqlCommand("""
                SELECT r.id, r.request_type, t.full_name, r.teacher_id, c.name, r.circle_id,
                       r.request_date, r.reason, r.status, r.created_at, r.requested_payload::text,
                       r.review_note, r.reviewed_at, ta.id
                FROM attendance_requests r
                JOIN teachers t ON t.id=r.teacher_id
                JOIN circles c ON c.id=r.circle_id
                LEFT JOIN teacher_attendance ta ON ta.id=r.attendance_id
                WHERE (@status='all' OR r.status=@status)
                ORDER BY (r.status='pending') DESC, r.created_at DESC
                LIMIT 250;
                """, connection))
            {
                command.Parameters.AddWithValue("status", filter);
                await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
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
            return Results.Ok(new { count = rows.Count, requests = rows });
        }).RequireAuthorization("attendance.edit");

        app.MapPost("/api/admin/requests/{id:guid}/review", async Task<IResult> (Guid id, AdminReviewRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
            if (note is { Length: > 2000 })
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["note"] = ["الملاحظة طويلة جدًا."] });

            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            string type, status, reason, payloadJson;
            Guid teacherId, circleId, slotId, attendanceId;
            DateOnly? requestDate, attendanceDate;

            await using (var read = new NpgsqlCommand("""
                SELECT r.request_type,r.status,r.reason,r.teacher_id,r.circle_id,r.schedule_slot_id,r.attendance_id,r.request_date,
                       COALESCE(r.requested_payload::text,'{}'),ta.session_date
                FROM attendance_requests r
                LEFT JOIN teacher_attendance ta ON ta.id=r.attendance_id
                WHERE r.id=@id FOR UPDATE OF r;
                """, connection, transaction))
            {
                read.Parameters.AddWithValue("id", id);
                await using var reader = await read.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct))
                {
                    await transaction.RollbackAsync(ct);
                    return Results.NotFound(new { message = "الطلب غير موجود." });
                }
                type = reader.GetString(0);
                status = reader.GetString(1);
                reason = reader.GetString(2);
                teacherId = reader.GetGuid(3);
                circleId = reader.GetGuid(4);
                slotId = reader.IsDBNull(5) ? Guid.Empty : reader.GetGuid(5);
                attendanceId = reader.IsDBNull(6) ? Guid.Empty : reader.GetGuid(6);
                requestDate = reader.IsDBNull(7) ? null : reader.GetFieldValue<DateOnly>(7);
                payloadJson = reader.GetString(8);
                attendanceDate = reader.IsDBNull(9) ? null : reader.GetFieldValue<DateOnly>(9);
            }

            if (status != "pending")
            {
                await transaction.RollbackAsync(ct);
                return Results.Conflict(new { message = "تمت مراجعة هذا الطلب بالفعل." });
            }

            if (request.Approve)
            {
                var lockDate = type == "correction" ? attendanceDate : requestDate;
                if (lockDate is not null)
                {
                    await using var lockCheck = new NpgsqlCommand("SELECT is_locked FROM payroll_locks WHERE billing_month=date_trunc('month',@date::date)::date;", connection, transaction);
                    lockCheck.Parameters.AddWithValue("date", lockDate.Value);
                    if (await lockCheck.ExecuteScalarAsync(ct) is bool locked && locked)
                    {
                        await transaction.RollbackAsync(ct);
                        return Results.Conflict(new { message = "مسير رواتب هذا الشهر مقفل. افتح المسير قبل اعتماد الطلب." });
                    }
                }
            }

            var nextStatus = request.Approve ? "approved" : "rejected";
            if (request.Approve)
            {
                if (type is "absence" or "cancellation")
                {
                    if (slotId == Guid.Empty || requestDate is null)
                    {
                        await transaction.RollbackAsync(ct);
                        return Results.ValidationProblem(new Dictionary<string, string[]> { ["request"] = ["بيانات الموعد ناقصة."] });
                    }
                    var attendanceStatus = type == "absence" ? "absent" : "cancelled";
                    await using var upsert = new NpgsqlCommand("""
                        INSERT INTO teacher_attendance(
                            schedule_slot_id,circle_id,teacher_id,session_date,scheduled_start,duration_minutes,
                            status,hourly_rate_snapshot,payable_amount,note,marked_by,actual_duration_minutes,
                            pay_basis,overtime_minutes,undertime_minutes,is_trashed)
                        SELECT ss.id,@circle,@teacher,@date,ss.starts_at,ss.duration_minutes,
                               @status,t.hourly_rate,0,@note,@reviewer,0,'manual',0,0,FALSE
                        FROM circle_schedule_slots ss JOIN teachers t ON t.id=@teacher
                        WHERE ss.id=@slot
                        ON CONFLICT(schedule_slot_id,session_date) DO UPDATE SET
                            status=EXCLUDED.status,duration_minutes=EXCLUDED.duration_minutes,payable_amount=0,
                            note=EXCLUDED.note,marked_by=EXCLUDED.marked_by,marked_at=now(),
                            actual_duration_minutes=0,pay_basis='manual',overtime_minutes=0,undertime_minutes=0,is_trashed=FALSE;
                        """, connection, transaction);
                    upsert.Parameters.AddWithValue("circle", circleId);
                    upsert.Parameters.AddWithValue("teacher", teacherId);
                    upsert.Parameters.AddWithValue("date", requestDate.Value);
                    upsert.Parameters.AddWithValue("slot", slotId);
                    upsert.Parameters.AddWithValue("status", attendanceStatus);
                    upsert.Parameters.AddWithValue("note", (object?)note ?? reason);
                    upsert.Parameters.AddWithValue("reviewer", DbGuid(ActorId(principal)));
                    await upsert.ExecuteNonQueryAsync(ct);

                    await using var session = new NpgsqlCommand("""
                        UPDATE teacher_sessions SET status='cancelled',note=COALESCE(@note,note),updated_at=now()
                        WHERE schedule_slot_id=@slot AND session_date=@date AND status IN ('in_progress','awaiting_attendance');
                        """, connection, transaction);
                    session.Parameters.AddWithValue("slot", slotId);
                    session.Parameters.AddWithValue("date", requestDate.Value);
                    session.Parameters.AddWithValue("note", (object?)note ?? DBNull.Value);
                    await session.ExecuteNonQueryAsync(ct);
                }
                else if (type == "correction")
                {
                    if (attendanceId == Guid.Empty)
                    {
                        await transaction.RollbackAsync(ct);
                        return Results.ValidationProblem(new Dictionary<string, string[]> { ["request"] = ["سجل الحضور غير موجود."] });
                    }
                    var payload = JsonDocument.Parse(payloadJson).RootElement;
                    var duration = payload.TryGetProperty("durationMinutes", out var durationValue) && durationValue.TryGetInt32(out var parsed) ? parsed : 0;
                    if (duration is < 1 or > 360)
                    {
                        await transaction.RollbackAsync(ct);
                        return Results.ValidationProblem(new Dictionary<string, string[]> { ["durationMinutes"] = ["المدة المقترحة غير صحيحة."] });
                    }
                    var proposedNote = payload.TryGetProperty("note", out var noteValue) ? noteValue.GetString() : null;

                    decimal rate;
                    int oldDuration;
                    await using (var current = new NpgsqlCommand("SELECT hourly_rate_snapshot,duration_minutes FROM teacher_attendance WHERE id=@id AND is_trashed=FALSE FOR UPDATE;", connection, transaction))
                    {
                        current.Parameters.AddWithValue("id", attendanceId);
                        await using var reader = await current.ExecuteReaderAsync(ct);
                        if (!await reader.ReadAsync(ct))
                        {
                            await transaction.RollbackAsync(ct);
                            return Results.NotFound(new { message = "سجل الحضور غير موجود." });
                        }
                        rate = reader.GetDecimal(0);
                        oldDuration = reader.GetInt32(1);
                    }
                    if (!MoneyRules.TryCalculateTeacherPayableAmount(rate, duration, out var amount))
                    {
                        await transaction.RollbackAsync(ct);
                        return Results.ValidationProblem(new Dictionary<string, string[]> { ["amount"] = ["تعذر حساب الأجر."] });
                    }
                    await using (var update = new NpgsqlCommand("""
                        UPDATE teacher_attendance SET duration_minutes=@duration,payable_amount=@amount,actual_duration_minutes=@duration,
                            pay_basis='manual',note=COALESCE(@note,note),marked_by=@reviewer,marked_at=now(),
                            overtime_minutes=0,undertime_minutes=0
                        WHERE id=@id;
                        """, connection, transaction))
                    {
                        update.Parameters.AddWithValue("id", attendanceId);
                        update.Parameters.AddWithValue("duration", duration);
                        update.Parameters.AddWithValue("amount", amount);
                        update.Parameters.AddWithValue("note", (object?)proposedNote ?? DBNull.Value);
                        update.Parameters.AddWithValue("reviewer", DbGuid(ActorId(principal)));
                        await update.ExecuteNonQueryAsync(ct);
                    }
                    await using (var session = new NpgsqlCommand("""
                        UPDATE teacher_sessions SET actual_duration_minutes=@duration,payable_duration_minutes=@duration,
                            pay_basis='manual',overtime_minutes=0,undertime_minutes=0,note=COALESCE(@note,note),updated_at=now()
                        WHERE id=(SELECT teacher_session_id FROM teacher_attendance WHERE id=@attendance);
                        """, connection, transaction))
                    {
                        session.Parameters.AddWithValue("attendance", attendanceId);
                        session.Parameters.AddWithValue("duration", duration);
                        session.Parameters.AddWithValue("note", (object?)proposedNote ?? DBNull.Value);
                        await session.ExecuteNonQueryAsync(ct);
                    }
                    await InsertRequestAuditAsync(connection, transaction, ActorId(principal), principal.FindFirstValue("display_name"),
                        "request.correction.apply", "teacher_attendance", attendanceId,
                        JsonSerializer.Serialize(new { oldDuration, newDuration = duration, amount }), id, ct);
                }
            }

            await using (var update = new NpgsqlCommand("""
                UPDATE attendance_requests SET status=@status,reviewed_by=@reviewer,reviewed_at=now(),review_note=@note,updated_at=now()
                WHERE id=@id;
                """, connection, transaction))
            {
                update.Parameters.AddWithValue("id", id);
                update.Parameters.AddWithValue("status", nextStatus);
                update.Parameters.AddWithValue("reviewer", DbGuid(ActorId(principal)));
                update.Parameters.AddWithValue("note", (object?)note ?? DBNull.Value);
                await update.ExecuteNonQueryAsync(ct);
            }

            await NotifyTeacherAsync(connection, transaction, teacherId, id,
                request.Approve ? "تم اعتماد طلبك" : "تم رفض طلبك",
                request.Approve ? "تمت مراجعة الطلب واعتماده." : $"تم رفض الطلب. {note ?? string.Empty}".Trim(), ct);

            await InsertRequestAuditAsync(connection, transaction, ActorId(principal), principal.FindFirstValue("display_name"),
                "request.review", "attendance_request", id,
                JsonSerializer.Serialize(new { approved = request.Approve, note, type }), id, ct);
            await transaction.CommitAsync(ct);
            return Results.Ok(new { id, status = nextStatus });
        }).RequireAuthorization("attendance.edit");
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
