using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

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
                WHERE r.is_trashed=FALSE AND (@status='all' OR r.status=@status)
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
            string? effectBefore = null;
            string? effectAfter = null;
            if (request.Approve)
            {
                effectBefore = await ReadAttendanceEffectAsync(connection, transaction, slotId, requestDate, attendanceId, ct);
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
                            note=CASE WHEN EXCLUDED.note IS NULL OR btrim(EXCLUDED.note)='' THEN teacher_attendance.note WHEN teacher_attendance.note IS NULL OR btrim(teacher_attendance.note)='' THEN EXCLUDED.note ELSE teacher_attendance.note || E'\n' || EXCLUDED.note END,
                            marked_by=EXCLUDED.marked_by,marked_at=now(),
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
                        UPDATE teacher_sessions SET status='cancelled',
                            note=CASE WHEN @note IS NULL OR btrim(@note)='' THEN note WHEN note IS NULL OR btrim(note)='' THEN @note ELSE note || E'\n' || @note END,
                            updated_at=now()
                        WHERE schedule_slot_id=@slot AND session_date=@date AND status IN ('in_progress','awaiting_attendance');
                        """, connection, transaction);
                    session.Parameters.AddWithValue("slot", slotId);
                    session.Parameters.AddWithValue("date", requestDate.Value);
                    // btrim(@note) needs an explicit text type; DBNull otherwise leaves the
                    // parameter untyped and PostgreSQL rejects it (42P08 -> HTTP 500).
                    session.Parameters.Add(new NpgsqlParameter("note", NpgsqlDbType.Text) { Value = (object?)note ?? DBNull.Value });
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
                            pay_basis='manual',
                            note=CASE WHEN @note IS NULL OR btrim(@note)='' THEN note WHEN note IS NULL OR btrim(note)='' THEN @note ELSE note || E'\n' || @note END,
                            marked_by=@reviewer,marked_at=now(),
                            overtime_minutes=0,undertime_minutes=0
                        WHERE id=@id;
                        """, connection, transaction))
                    {
                        update.Parameters.AddWithValue("id", attendanceId);
                        update.Parameters.AddWithValue("duration", duration);
                        update.Parameters.AddWithValue("amount", amount);
                        update.Parameters.Add(new NpgsqlParameter("note", NpgsqlDbType.Text) { Value = (object?)proposedNote ?? DBNull.Value });
                        update.Parameters.AddWithValue("reviewer", DbGuid(ActorId(principal)));
                        await update.ExecuteNonQueryAsync(ct);
                    }
                    await using (var session = new NpgsqlCommand("""
                        UPDATE teacher_sessions SET actual_duration_minutes=@duration,payable_duration_minutes=@duration,
                            pay_basis='manual',overtime_minutes=0,undertime_minutes=0,
                            note=CASE WHEN @note IS NULL OR btrim(@note)='' THEN note WHEN note IS NULL OR btrim(note)='' THEN @note ELSE note || E'\n' || @note END,
                            updated_at=now()
                        WHERE id=(SELECT teacher_session_id FROM teacher_attendance WHERE id=@attendance);
                        """, connection, transaction))
                    {
                        session.Parameters.AddWithValue("attendance", attendanceId);
                        session.Parameters.AddWithValue("duration", duration);
                        session.Parameters.Add(new NpgsqlParameter("note", NpgsqlDbType.Text) { Value = (object?)proposedNote ?? DBNull.Value });
                        await session.ExecuteNonQueryAsync(ct);
                    }
                    await InsertRequestAuditAsync(connection, transaction, ActorId(principal), principal.FindFirstValue("display_name"),
                        "request.correction.apply", "teacher_attendance", attendanceId,
                        JsonSerializer.Serialize(new { oldDuration, newDuration = duration, amount }), id, ct);
                }
            }

            if (request.Approve)
                effectAfter = await ReadAttendanceEffectAsync(connection, transaction, slotId, requestDate, attendanceId, ct);

            await using (var update = new NpgsqlCommand("""
                UPDATE attendance_requests SET status=@status,reviewed_by=@reviewer,reviewed_at=now(),review_note=@note,
                    effect_before=@effectBefore::jsonb,effect_after=@effectAfter::jsonb,updated_at=now()
                WHERE id=@id;
                """, connection, transaction))
            {
                update.Parameters.AddWithValue("id", id);
                update.Parameters.AddWithValue("status", nextStatus);
                update.Parameters.AddWithValue("reviewer", DbGuid(ActorId(principal)));
                update.Parameters.Add(new NpgsqlParameter("note", NpgsqlDbType.Text) { Value = (object?)note ?? DBNull.Value });
                update.Parameters.AddWithValue("effectBefore", (object?)effectBefore ?? DBNull.Value);
                update.Parameters.AddWithValue("effectAfter", (object?)effectAfter ?? DBNull.Value);
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

        app.MapPost("/api/admin/requests/{id:guid}/reopen", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            string status;
            string? effectBefore, effectAfter;
            Guid teacherId;
            await using (var read = new NpgsqlCommand("""
                SELECT status,COALESCE(effect_before::text,''),COALESCE(effect_after::text,''),teacher_id
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
            }
            if (status != "approved")
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
            await NotifyTeacherAsync(connection, transaction, teacherId, id, "أُعيد طلبك للمراجعة",
                "تم إرجاع الطلب إلى قائمة المراجعة بعد عكس أثره السابق.", ct);
            await InsertRequestAuditAsync(connection, transaction, ActorId(principal), principal.FindFirstValue("display_name"),
                "request.reopen", "attendance_request", id, JsonSerializer.Serialize(new { status }), id, ct);
            await transaction.CommitAsync(ct);
            return Results.Ok(new { id, status = "pending" });
        }).RequireAuthorization("users.manage");

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
            if (status != "pending")
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
        }).RequireAuthorization("attendance.edit");

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
            if (status == "approved")
            {
                await transaction.RollbackAsync(ct);
                return Results.Conflict(new { message = "أعد الطلب المعتمد للمراجعة أولًا قبل حذفه." });
            }
            await using (var update = new NpgsqlCommand("UPDATE attendance_requests SET is_trashed=TRUE,updated_at=now() WHERE id=@id;", connection, transaction))
            {
                update.Parameters.AddWithValue("id", id);
                await update.ExecuteNonQueryAsync(ct);
            }
            await InsertRequestAuditAsync(connection, transaction, ActorId(principal), principal.FindFirstValue("display_name"),
                "request.delete", "attendance_request", id, JsonSerializer.Serialize(new { previousStatus = status }), id, ct);
            await transaction.CommitAsync(ct);
            return Results.Ok(new { id, deleted = true });
        }).RequireAuthorization("users.manage");
    }

    private static async Task<string?> ReadAttendanceEffectAsync(NpgsqlConnection connection, NpgsqlTransaction transaction,
        Guid slotId, DateOnly? date, Guid attendanceId, CancellationToken ct)
    {
        string sql;
        if (attendanceId != Guid.Empty)
            sql = """
                SELECT jsonb_build_object('attendance', to_jsonb(ta), 'session', to_jsonb(ts))::text
                FROM (SELECT 1) anchor
                LEFT JOIN teacher_attendance ta ON ta.id=@attendance
                LEFT JOIN teacher_sessions ts ON ts.id=ta.teacher_session_id;
                """;
        else if (slotId != Guid.Empty && date is not null)
            sql = """
                SELECT jsonb_build_object('attendance', to_jsonb(ta), 'session', to_jsonb(ts))::text
                FROM (SELECT 1) anchor
                LEFT JOIN teacher_attendance ta ON ta.schedule_slot_id=@slot AND ta.session_date=@date AND ta.is_trashed=FALSE
                LEFT JOIN teacher_sessions ts ON ts.schedule_slot_id=@slot AND ts.session_date=@date;
                """;
        else
            return null;

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("attendance", attendanceId == Guid.Empty ? DBNull.Value : attendanceId);
        command.Parameters.AddWithValue("slot", slotId);
        command.Parameters.AddWithValue("date", (object?)date ?? DBNull.Value);
        return await command.ExecuteScalarAsync(ct) as string;
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
