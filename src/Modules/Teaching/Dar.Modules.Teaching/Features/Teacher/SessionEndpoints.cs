using System.Security.Claims;
using Dar.Common.Domain;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Teacher;

public static class SessionEndpoints
{
    public static async Task<IResult> Start(
        StartSessionRequest request,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var teacherId = TeachingPrincipal.TeacherId(principal);
        var userId = TeachingPrincipal.UserId(principal);
        if (teacherId == Guid.Empty || userId == Guid.Empty)
            return Results.Json(new { message = "هذا الحساب غير مرتبط بمعلمة. راجع المدير." }, statusCode: StatusCodes.Status403Forbidden);

        var date = CairoTime.Today();
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        Guid circleId;
        int duration;
        TimeOnly startsAt;
        int dayOfWeek;
        string circleName;
        decimal hourlyRate;
        await using (var slot = new NpgsqlCommand("""
            SELECT ss.circle_id, ss.duration_minutes, ss.starts_at, ss.day_of_week, c.name, t.hourly_rate
            FROM circle_schedule_slots ss
            JOIN circles c ON c.id = ss.circle_id AND c.is_trashed = FALSE AND c.is_active = TRUE
            JOIN teachers t ON t.id = c.teacher_id AND t.is_trashed = FALSE AND t.status = 'active'
            WHERE ss.id = @slot AND ss.is_active = TRUE AND ss.is_trashed = FALSE AND c.teacher_id = @teacher;
            """, connection, transaction))
        {
            slot.Parameters.AddWithValue("slot", request.ScheduleSlotId);
            slot.Parameters.AddWithValue("teacher", teacherId);
            await using var reader = await slot.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
                return Results.NotFound(new { message = "الحلقة غير موجودة أو غير مسندة إليك." });
            circleId = reader.GetGuid(0);
            duration = reader.GetInt32(1);
            startsAt = reader.GetFieldValue<TimeOnly>(2);
            dayOfWeek = reader.GetInt16(3);
            circleName = reader.GetString(4);
            hourlyRate = reader.GetDecimal(5);
        }

        if (dayOfWeek != (int)date.DayOfWeek)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["scheduleSlotId"] = ["هذه الحلقة ليست ضمن جدول اليوم."] });

        await using (var open = new NpgsqlCommand("""
            SELECT id FROM teacher_sessions
            WHERE teacher_id = @teacher AND session_date = @date AND status = 'in_progress'
              AND schedule_slot_id <> @slot
            LIMIT 1;
            """, connection, transaction))
        {
            open.Parameters.AddWithValue("teacher", teacherId);
            open.Parameters.AddWithValue("date", date);
            open.Parameters.AddWithValue("slot", request.ScheduleSlotId);
            if (await open.ExecuteScalarAsync(ct) is not null)
                return Results.Conflict(new { message = "لديك حلقة جارية بالفعل. أنهيها أولًا." });
        }

        var sessionId = Guid.NewGuid();
        Guid? createdId = null;
        await using (var insert = new NpgsqlCommand("""
            INSERT INTO teacher_sessions(id, teacher_id, circle_id, schedule_slot_id, session_date, started_at, status, scheduled_duration_minutes, created_by)
            VALUES (@id, @teacher, @circle, @slot, @date, now(), 'in_progress', @duration, @user)
            ON CONFLICT (schedule_slot_id, session_date) DO NOTHING
            RETURNING id;
            """, connection, transaction))
        {
            insert.Parameters.AddWithValue("id", sessionId);
            insert.Parameters.AddWithValue("teacher", teacherId);
            insert.Parameters.AddWithValue("circle", circleId);
            insert.Parameters.AddWithValue("slot", request.ScheduleSlotId);
            insert.Parameters.AddWithValue("date", date);
            insert.Parameters.AddWithValue("duration", duration);
            insert.Parameters.AddWithValue("user", userId);
            createdId = (Guid?)await insert.ExecuteScalarAsync(ct);
        }

        if (createdId is null)
        {
            string existingStatus;
            Guid existingId;
            await using (var existing = new NpgsqlCommand("""
                SELECT id, status FROM teacher_sessions
                WHERE schedule_slot_id = @slot AND session_date = @date
                FOR UPDATE;
                """, connection, transaction))
            {
                existing.Parameters.AddWithValue("slot", request.ScheduleSlotId);
                existing.Parameters.AddWithValue("date", date);
                await using var reader = await existing.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct))
                    return Results.Conflict(new { message = "تعذر بدء الحلقة. حاول مرة أخرى." });
                existingId = reader.GetGuid(0);
                existingStatus = reader.GetString(1);
            }
            await transaction.CommitAsync(ct);
            if (existingStatus is "completed" or "cancelled")
                return Results.Conflict(new { message = "هذه الحلقة مسجلة بالفعل لهذا اليوم.", sessionId = existingId });
            return Results.Ok(new { sessionId = existingId, status = existingStatus, resumed = true, scheduledDurationMinutes = duration, circleName, startsAt = startsAt.ToString("HH:mm"), hourlyRate });
        }

        await TeachingAudit.WriteAsync(connection, transaction, principal, "teacher.session.start", "teacher_session", createdId.Value,
            new { scheduleSlotId = request.ScheduleSlotId, sessionDate = date, scheduledDurationMinutes = duration }, $"/api/v1/teacher/sessions/{createdId}", "POST", ct);
        await transaction.CommitAsync(ct);
        return Results.Created($"/api/v1/teacher/sessions/{createdId}", new
        {
            sessionId = createdId,
            status = "in_progress",
            resumed = false,
            scheduledDurationMinutes = duration,
            circleName,
            startsAt = startsAt.ToString("HH:mm"),
            hourlyRate
        });
    }

    public static async Task<IResult> End(
        Guid id,
        EndSessionRequest request,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var teacherId = TeachingPrincipal.TeacherId(principal);
        var userId = TeachingPrincipal.UserId(principal);
        if (teacherId == Guid.Empty || userId == Guid.Empty)
            return Results.Json(new { message = "هذا الحساب غير مرتبط بمعلمة. راجع المدير." }, statusCode: StatusCodes.Status403Forbidden);

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        string status;
        DateOnly sessionDate;
        DateTimeOffset startedAt;
        DateTimeOffset? endedAt;
        int scheduled;
        int? actualStored;
        int? payableStored;
        string? basisStored;
        int overtimeStored;
        int undertimeStored;
        string? noteStored;
        string circleName;
        decimal hourlyRate;

        await using (var command = new NpgsqlCommand("""
            SELECT ts.status, ts.session_date, ts.started_at, ts.ended_at,
                   ts.scheduled_duration_minutes, ts.actual_duration_minutes, ts.payable_duration_minutes,
                   ts.pay_basis, ts.overtime_minutes, ts.undertime_minutes, ts.note,
                   c.name, t.hourly_rate
            FROM teacher_sessions ts
            JOIN circles c ON c.id = ts.circle_id
            JOIN teachers t ON t.id = ts.teacher_id
            WHERE ts.id = @id AND ts.teacher_id = @teacher
            FOR UPDATE OF ts;
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("id", id);
            command.Parameters.AddWithValue("teacher", teacherId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
                return Results.NotFound(new { message = "الحلقة غير موجودة." });
            status = reader.GetString(0);
            sessionDate = reader.GetFieldValue<DateOnly>(1);
            startedAt = reader.GetFieldValue<DateTimeOffset>(2);
            endedAt = reader.IsDBNull(3) ? null : reader.GetFieldValue<DateTimeOffset>(3);
            scheduled = reader.GetInt32(4);
            actualStored = reader.IsDBNull(5) ? null : reader.GetInt32(5);
            payableStored = reader.IsDBNull(6) ? null : reader.GetInt32(6);
            basisStored = reader.IsDBNull(7) ? null : reader.GetString(7);
            overtimeStored = reader.GetInt32(8);
            undertimeStored = reader.GetInt32(9);
            noteStored = reader.IsDBNull(10) ? null : reader.GetString(10);
            circleName = reader.GetString(11);
            hourlyRate = reader.GetDecimal(12);
        }

        if (status is "completed" or "cancelled")
            return Results.Conflict(new { message = "هذه الحلقة مغلقة بالفعل." });

        if (endedAt is not null)
        {
            await transaction.CommitAsync(ct);
            return Results.Ok(new
            {
                sessionId = id,
                status,
                alreadyEnded = true,
                actualDurationMinutes = actualStored ?? 0,
                payableDurationMinutes = payableStored ?? 0,
                overtimeMinutes = overtimeStored,
                undertimeMinutes = undertimeStored,
                payBasis = basisStored,
                payableAmount = (decimal?)null,
                note = noteStored,
                message = "تم إنهاء الحلقة بالفعل. أكمل تسجيل الطالبات."
            });
        }

        var end = DateTimeOffset.UtcNow;
        var actual = (int)Math.Floor((end - startedAt).TotalMinutes);
        actual = Math.Clamp(actual, 0, 1440);
        if (!Money.TryCalculateTeacherSessionPay(hourlyRate, scheduled, actual, out var pay))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["duration"] = ["تعذر حساب مدة الحلقة. راجع إعدادات الحلقة."] });

        var note = string.IsNullOrWhiteSpace(request.Note) ? noteStored : request.Note.Trim();
        await using (var update = new NpgsqlCommand("""
            UPDATE teacher_sessions
            SET ended_at=@end, status='awaiting_attendance', actual_duration_minutes=@actual,
                payable_duration_minutes=@payable, pay_basis=@basis,
                overtime_minutes=@overtime, undertime_minutes=@undertime, note=@note, updated_at=now()
            WHERE id=@id;
            """, connection, transaction))
        {
            update.Parameters.AddWithValue("end", end);
            update.Parameters.AddWithValue("actual", pay.ActualMinutes);
            update.Parameters.AddWithValue("payable", pay.PayableMinutes);
            update.Parameters.AddWithValue("basis", pay.PayBasis);
            update.Parameters.AddWithValue("overtime", pay.OvertimeMinutes);
            update.Parameters.AddWithValue("undertime", pay.UndertimeMinutes);
            update.Parameters.AddWithValue("note", (object?)note ?? DBNull.Value);
            update.Parameters.AddWithValue("id", id);
            await update.ExecuteNonQueryAsync(ct);
        }

        await using (var attendance = new NpgsqlCommand("""
            INSERT INTO teacher_attendance(schedule_slot_id, circle_id, teacher_id, session_date, scheduled_start,
                duration_minutes, status, hourly_rate_snapshot, payable_amount, note, marked_by, teacher_session_id,
                actual_duration_minutes, pay_basis, overtime_minutes, undertime_minutes, is_trashed)
            SELECT ts.schedule_slot_id, ts.circle_id, ts.teacher_id, ts.session_date, ss.starts_at,
                   @payable, 'present', @rate, @amount, @note, @user, ts.id,
                   @actual, @basis, @overtime, @undertime, FALSE
            FROM teacher_sessions ts
            JOIN circle_schedule_slots ss ON ss.id = ts.schedule_slot_id
            WHERE ts.id = @id
            ON CONFLICT (schedule_slot_id, session_date) DO UPDATE SET
                duration_minutes=EXCLUDED.duration_minutes,
                status='present',
                hourly_rate_snapshot=EXCLUDED.hourly_rate_snapshot,
                payable_amount=EXCLUDED.payable_amount,
                note=EXCLUDED.note,
                marked_by=EXCLUDED.marked_by,
                marked_at=now(),
                teacher_session_id=EXCLUDED.teacher_session_id,
                actual_duration_minutes=EXCLUDED.actual_duration_minutes,
                pay_basis=EXCLUDED.pay_basis,
                overtime_minutes=EXCLUDED.overtime_minutes,
                undertime_minutes=EXCLUDED.undertime_minutes,
                is_trashed=FALSE;
            """, connection, transaction))
        {
            attendance.Parameters.AddWithValue("payable", pay.PayableMinutes);
            attendance.Parameters.AddWithValue("rate", hourlyRate);
            attendance.Parameters.AddWithValue("amount", pay.PayableAmount);
            attendance.Parameters.AddWithValue("note", (object?)note ?? DBNull.Value);
            attendance.Parameters.AddWithValue("user", userId);
            attendance.Parameters.AddWithValue("actual", pay.ActualMinutes);
            attendance.Parameters.AddWithValue("basis", pay.PayBasis);
            attendance.Parameters.AddWithValue("overtime", pay.OvertimeMinutes);
            attendance.Parameters.AddWithValue("undertime", pay.UndertimeMinutes);
            attendance.Parameters.AddWithValue("id", id);
            await attendance.ExecuteNonQueryAsync(ct);
        }

        await TeachingNotifications.OpenAsync(connection, transaction, userId, null, "attendance", "warning",
            "لم تسجلي حضور الطالبات بعد",
            $"حلقة {circleName} — {sessionDate:yyyy-MM-dd}. أكمل تسجيل الحضور.",
            "teacher_session", id, $"/teacher/roster/{id}", $"missing-attendance:{id}", ct);

        await TeachingAudit.WriteAsync(connection, transaction, principal, "teacher.session.end", "teacher_session", id,
            new { actualMinutes = pay.ActualMinutes, payableMinutes = pay.PayableMinutes, payBasis = pay.PayBasis, overtimeMinutes = pay.OvertimeMinutes, undertimeMinutes = pay.UndertimeMinutes, payableAmount = pay.PayableAmount, note },
            $"/api/v1/teacher/sessions/{id}/end", "POST", ct);
        await transaction.CommitAsync(ct);

        var message = pay.ActualMinutes >= scheduled
            ? $"انتهت بعد الموعد بـ {pay.OvertimeMinutes} دقيقة. تم احتساب مدة الحلقة {scheduled} دقيقة."
            : pay.ActualMinutes == 0
                ? "أقل من دقيقة — احتُسبت دقيقة واحدة."
                : $"انتهت قبل الموعد بـ {pay.UndertimeMinutes} دقيقة. تم احتساب الوقت الفعلي {pay.PayableMinutes} دقيقة.";

        return Results.Ok(new
        {
            sessionId = id,
            status = "awaiting_attendance",
            alreadyEnded = false,
            actualDurationMinutes = pay.ActualMinutes,
            payableDurationMinutes = pay.PayableMinutes,
            overtimeMinutes = pay.OvertimeMinutes,
            undertimeMinutes = pay.UndertimeMinutes,
            payBasis = pay.PayBasis,
            payableAmount = pay.PayableAmount,
            note,
            message
        });
    }
}
