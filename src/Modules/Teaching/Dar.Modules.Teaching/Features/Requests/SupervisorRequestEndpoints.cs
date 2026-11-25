using System.Security.Claims;
using System.Text.Json;
using Dar.Common.Requests;
using Dar.Common.Domain;
using Npgsql;
using NpgsqlTypes;
using Dar.Modules.Teaching.Features.Supervisor;

namespace Dar.Modules.Teaching.Features.Requests;

public static class SupervisorRequestEndpoints
{
    public static async Task<IResult> List(
        string? status,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var filter = string.IsNullOrWhiteSpace(status) ? "pending" : status.Trim().ToLowerInvariant();
        if (filter is not ("pending" or "approved" or "rejected" or "cancelled" or "all"))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["status"] = ["حالة غير صحيحة."] });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);

        await using var command = new NpgsqlCommand("""
            SELECT r.id, r.request_type, t.full_name, r.teacher_id, c.name, r.circle_id,
                   r.request_date, r.reason, r.status, r.created_at, r.requested_payload::text,
                   r.review_note, r.reviewed_at, ta.id
            FROM attendance_requests r
            JOIN teachers t ON t.id = r.teacher_id
            JOIN circles c ON c.id = r.circle_id
            LEFT JOIN teacher_attendance ta ON ta.id = r.attendance_id
            WHERE (@all OR r.circle_id = ANY(@circles))
              AND (@status = 'all' OR r.status = @status)
            ORDER BY (r.status = 'pending') DESC, r.created_at DESC
            LIMIT 200;
            """, connection);
        command.Parameters.AddWithValue("all", scope.All);
        command.Parameters.AddWithValue("circles", scope.CircleIds);
        command.Parameters.AddWithValue("status", filter);

        var rows = new List<object>();
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
        return Results.Ok(new { count = rows.Count, requests = rows });
    }

    public static async Task<IResult> Review(
        Guid id,
        ReviewRequestRequest request,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var reviewer = TeachingPrincipal.UserId(principal);
        var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
        if (note is { Length: > 2000 })
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["note"] = ["الملاحظة طويلة جدًا."] });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);

        await using var transaction = await connection.BeginTransactionAsync(ct);
        string type, status, reason, payloadJson;
        Guid teacherId, circleId, slotId, attendanceId;
        DateOnly? requestDate;

        await using (var command = new NpgsqlCommand("""
            SELECT request_type, status, reason, teacher_id, circle_id, schedule_slot_id,
                   attendance_id, request_date, COALESCE(requested_payload::text, '{}')
            FROM attendance_requests
            WHERE id = @id
            FOR UPDATE;
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("id", id);
            await using var reader = await command.ExecuteReaderAsync(ct);
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
        }

        if (!scope.All)
        {
            if (!scope.AllowsCircle(circleId) || !scope.AllowsTeacher(teacherId))
            {
                await transaction.RollbackAsync(ct);
                return Results.Json(new { message = "هذا الطلب خارج نطاقك." }, statusCode: StatusCodes.Status403Forbidden);
            }
        }

        if (!RequestWorkflow.CanReview(status))
        {
            await transaction.RollbackAsync(ct);
            return Results.Conflict(new { message = "تمت مراجعة هذا الطلب بالفعل." });
        }

        var nextStatus = RequestWorkflow.ReviewStatus(request.Approve);
        string? effectBefore = null;
        string? effectAfter = null;

        if (request.Approve)
        {
            effectBefore = await RequestEffectReader.ReadAsync(connection, transaction, slotId, requestDate, attendanceId, ct);
            if (type is "absence" or "cancellation")
            {
                if (slotId == Guid.Empty || requestDate is null)
                {
                    await transaction.RollbackAsync(ct);
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["request"] = ["بيانات الموعد ناقصة."] });
                }
                if (await PayrollLock.CheckAsync(connection, transaction, requestDate.Value, ct) is { } locked)
                {
                    await transaction.RollbackAsync(ct);
                    return locked;
                }
                var attendanceStatus = type == "absence" ? "absent" : "cancelled";
                await using var upsert = new NpgsqlCommand("""
                    INSERT INTO teacher_attendance(
                        schedule_slot_id, circle_id, teacher_id, session_date, scheduled_start,
                        duration_minutes, status, hourly_rate_snapshot, payable_amount, note,
                        marked_by, actual_duration_minutes, pay_basis, overtime_minutes, undertime_minutes, is_trashed)
                    SELECT ss.id, @circle, @teacher, @date, ss.starts_at, ss.duration_minutes,
                           @status, t.hourly_rate, 0, @note, @reviewer, 0, 'manual', 0, 0, FALSE
                    FROM circle_schedule_slots ss
                    JOIN teachers t ON t.id = @teacher
                    WHERE ss.id = @slot
                    ON CONFLICT (schedule_slot_id, session_date) DO UPDATE SET
                        status = EXCLUDED.status,
                        duration_minutes = EXCLUDED.duration_minutes,
                        payable_amount = 0,
                        note = CASE WHEN EXCLUDED.note IS NULL OR btrim(EXCLUDED.note)='' THEN teacher_attendance.note WHEN teacher_attendance.note IS NULL OR btrim(teacher_attendance.note)='' THEN EXCLUDED.note ELSE teacher_attendance.note || E'\n' || EXCLUDED.note END,
                        marked_by = EXCLUDED.marked_by,
                        marked_at = now(),
                        actual_duration_minutes = 0,
                        pay_basis = 'manual',
                        overtime_minutes = 0,
                        undertime_minutes = 0,
                        is_trashed = FALSE;
                    """, connection, transaction);
                upsert.Parameters.AddWithValue("circle", circleId);
                upsert.Parameters.AddWithValue("teacher", teacherId);
                upsert.Parameters.AddWithValue("date", requestDate.Value);
                upsert.Parameters.AddWithValue("slot", slotId);
                upsert.Parameters.AddWithValue("status", attendanceStatus);
                upsert.Parameters.AddWithValue("note", note ?? reason);
                upsert.Parameters.AddWithValue("reviewer", reviewer);
                await upsert.ExecuteNonQueryAsync(ct);

                await using var session = new NpgsqlCommand("""
                    UPDATE teacher_sessions
                    SET status='cancelled',
                        note=CASE WHEN @note IS NULL OR btrim(@note)='' THEN note WHEN note IS NULL OR btrim(note)='' THEN @note ELSE note || E'\n' || @note END,
                        updated_at=now()
                    WHERE schedule_slot_id=@slot AND session_date=@date AND status IN ('in_progress','awaiting_attendance');
                    """, connection, transaction);
                session.Parameters.AddWithValue("slot", slotId);
                session.Parameters.AddWithValue("date", requestDate.Value);
                // btrim(@note) needs an explicit text type; a DBNull value otherwise leaves the
                // parameter untyped and PostgreSQL rejects the statement (42P08 -> HTTP 500).
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
                var duration = payload.TryGetProperty("durationMinutes", out var durationValue) && durationValue.TryGetInt32(out var parsedDuration)
                    ? parsedDuration : 0;
                if (duration is < 1 or > 360)
                {
                    await transaction.RollbackAsync(ct);
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["durationMinutes"] = ["المدة المقترحة غير صحيحة."] });
                }
                var proposedNote = payload.TryGetProperty("note", out var noteValue) ? noteValue.GetString() : null;
                var proposedStatus = payload.TryGetProperty("status", out var statusValue) ? statusValue.GetString() : null;
                if (proposedStatus is not null && proposedStatus is not ("present" or "absent" or "cancelled"))
                {
                    await transaction.RollbackAsync(ct);
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["status"] = ["حالة الحضور المقترحة غير صحيحة."] });
                }

                decimal rate;
                int oldDuration;
                string oldStatus;
                DateOnly attendanceDate;
                await using (var current = new NpgsqlCommand("""
                    SELECT hourly_rate_snapshot, duration_minutes, session_date, status
                    FROM teacher_attendance
                    WHERE id=@id AND is_trashed=FALSE
                    FOR UPDATE;
                    """, connection, transaction))
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
                    attendanceDate = reader.GetFieldValue<DateOnly>(2);
                    oldStatus = reader.GetString(3);
                }

                // The payroll lock must be enforced on the review path too: approving a
                // correction changes the teacher's payable amount in the same way a direct
                // adjustment does.
                if (await PayrollLock.CheckAsync(connection, transaction, attendanceDate, ct) is { } locked)
                {
                    await transaction.RollbackAsync(ct);
                    return locked;
                }

                if (!Money.TryCalculateTeacherPayableAmount(rate, duration, out var computedAmount))
                {
                    await transaction.RollbackAsync(ct);
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["amount"] = ["تعذر حساب الأجر."] });
                }

                // P0-5: the correction carries the attendance status it proposes. Keep the current
                // status for old requests that have no status field. Only a present record is paid.
                var newStatus = proposedStatus ?? oldStatus;
                var amount = newStatus == "present" ? computedAmount : 0m;
                // teacher_sessions.payable_duration_minutes allows NULL or 1..360 only.
                var payableDuration = newStatus == "present" ? (int?)duration : null;

                await using (var update = new NpgsqlCommand("""
                    UPDATE teacher_attendance ta
                    SET status=@status, duration_minutes=@duration, payable_amount=@amount, actual_duration_minutes=@duration,
                        pay_basis='manual',
                        note=CASE WHEN @note IS NULL OR btrim(@note)='' THEN ta.note WHEN ta.note IS NULL OR btrim(ta.note)='' THEN @note ELSE ta.note || E'\n' || @note END,
                        marked_by=@reviewer, marked_at=now(),
                        overtime_minutes=0, undertime_minutes=0
                    WHERE ta.id=@id;
                    """, connection, transaction))
                {
                    update.Parameters.AddWithValue("id", attendanceId);
                    update.Parameters.AddWithValue("status", newStatus);
                    update.Parameters.AddWithValue("duration", duration);
                    update.Parameters.AddWithValue("amount", amount);
                    update.Parameters.Add(new NpgsqlParameter("note", NpgsqlDbType.Text) { Value = (object?)proposedNote ?? DBNull.Value });
                    update.Parameters.AddWithValue("reviewer", reviewer);
                    await update.ExecuteNonQueryAsync(ct);
                }

                await using (var session = new NpgsqlCommand("""
                    UPDATE teacher_sessions
                    SET actual_duration_minutes=@duration, payable_duration_minutes=@payableDuration,
                        pay_basis='manual', overtime_minutes=0, undertime_minutes=0,
                        status=CASE WHEN @status='present' AND status='cancelled' THEN 'completed' ELSE status END,
                        note=CASE WHEN @note IS NULL OR btrim(@note)='' THEN note WHEN note IS NULL OR btrim(note)='' THEN @note ELSE note || E'\n' || @note END,
                        updated_at=now()
                    WHERE id = (SELECT teacher_session_id FROM teacher_attendance WHERE id=@attendance);
                    """, connection, transaction))
                {
                    session.Parameters.AddWithValue("attendance", attendanceId);
                    session.Parameters.AddWithValue("duration", duration);
                    session.Parameters.AddWithValue("payableDuration", (object?)payableDuration ?? DBNull.Value);
                    session.Parameters.AddWithValue("status", newStatus);
                    session.Parameters.Add(new NpgsqlParameter("note", NpgsqlDbType.Text) { Value = (object?)proposedNote ?? DBNull.Value });
                    await session.ExecuteNonQueryAsync(ct);
                }

                await TeachingAudit.WriteAsync(connection, transaction, principal, "request.correction.apply", "teacher_attendance", attendanceId,
                    new { oldDuration, oldStatus, newDuration = duration, newStatus, amount }, $"/api/v1/supervisor/requests/{id}/review", "POST", ct);
            }
        }

        if (request.Approve)
            effectAfter = await RequestEffectReader.ReadAsync(connection, transaction, slotId, requestDate, attendanceId, ct);

        await using (var update = new NpgsqlCommand("""
            UPDATE attendance_requests
            SET status=@status, reviewed_by=@reviewer, reviewed_at=now(), review_note=@note,
                effect_before=@effectBefore::jsonb, effect_after=@effectAfter::jsonb, updated_at=now()
            WHERE id=@id;
            """, connection, transaction))
        {
            update.Parameters.AddWithValue("id", id);
            update.Parameters.AddWithValue("status", nextStatus);
            update.Parameters.AddWithValue("reviewer", reviewer);
            update.Parameters.Add(new NpgsqlParameter("note", NpgsqlDbType.Text) { Value = (object?)note ?? DBNull.Value });
            update.Parameters.AddWithValue("effectBefore", (object?)effectBefore ?? DBNull.Value);
            update.Parameters.AddWithValue("effectAfter", (object?)effectAfter ?? DBNull.Value);
            await update.ExecuteNonQueryAsync(ct);
        }

        // P1-5: close the supervisor request notification in the same transaction.
        // If this fails, the exception rolls back the request review as well.
        await TeachingNotifications.ResolveAsync(connection, transaction, $"request:{id}", reviewer,
            request.Approve ? "تم اعتماد الطلب." : "تم رفض الطلب.", ct);

        await RequestHelpers.NotifyTeacherAsync(connection, transaction, teacherId,
            request.Approve ? "تم اعتماد طلبك" : "تم رفض طلبك",
            request.Approve ? "تمت مراجعة الطلب واعتماده." : $"تم رفض الطلب. {note ?? ""}".Trim(),
            id, $"request-review:{id}", ct);

        await TeachingAudit.WriteAsync(connection, transaction, principal, "request.review", "attendance_request", id,
            new { approved = request.Approve, note }, $"/api/v1/supervisor/requests/{id}/review", "POST", ct);
        await transaction.CommitAsync(ct);

        return Results.Ok(new { id, status = nextStatus });
    }

}
