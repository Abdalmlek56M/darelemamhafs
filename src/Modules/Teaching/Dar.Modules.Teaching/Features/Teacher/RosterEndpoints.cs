using System.Security.Claims;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Teacher;

public static class RosterEndpoints
{
    private sealed record SessionInfo(Guid SlotId, DateOnly Date, Guid CircleId, string Status);

    private static async Task<SessionInfo?> LoadSessionAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        Guid sessionId,
        Guid teacherId,
        CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("""
            SELECT schedule_slot_id, session_date, circle_id, status
            FROM teacher_sessions
            WHERE id=@id AND teacher_id=@teacher
            FOR UPDATE;
            """, connection, transaction);
        command.Parameters.AddWithValue("id", sessionId);
        command.Parameters.AddWithValue("teacher", teacherId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        return new SessionInfo(reader.GetGuid(0), reader.GetFieldValue<DateOnly>(1), reader.GetGuid(2), reader.GetString(3));
    }

    public static async Task<IResult> Roster(
        Guid id,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var teacherId = TeachingPrincipal.TeacherId(principal);
        if (teacherId == Guid.Empty)
            return Results.Json(new { message = "هذا الحساب غير مرتبط بمعلمة. راجع المدير." }, statusCode: StatusCodes.Status403Forbidden);

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var session = await LoadSessionAsync(connection, null, id, teacherId, ct);
        if (session is null) return Results.NotFound(new { message = "الحلقة غير موجودة." });

        var rows = new List<object>();
        await using var command = new NpgsqlCommand("""
            WITH candidates AS (
                SELECT ce.id AS enrollment_id, s.id AS student_id, s.student_code, s.full_name,
                       sa.status, sa.note,
                       (ce.starts_on<=@date AND (ce.ends_on IS NULL OR ce.ends_on>=@date) AND attendance_circle.starts_on<=@date
                         AND public.dar_enrollment_is_attendance_eligible_on_date(ce.id,@date)) AS eligible_for_date,
                       CASE
                         WHEN attendance_circle.starts_on>@date THEN 'before-circle-start'
                         WHEN ce.starts_on>@date THEN 'before-enrollment-start'
                         WHEN ce.ends_on IS NOT NULL AND @date>ce.ends_on THEN 'after-enrollment-end'
                         WHEN COALESCE(lifecycle.status_at_date, CASE WHEN ce.ends_on IS NOT NULL AND @date>ce.ends_on THEN 'ended' WHEN ce.status='paused' AND @date>=CURRENT_DATE THEN 'paused' ELSE 'active' END)='paused' THEN 'paused'
                         WHEN NOT public.dar_enrollment_is_attendance_eligible_on_date(ce.id,@date) THEN 'not-active-on-date'
                         ELSE NULL
                       END AS eligibility_reason,
                       ce.starts_on, ce.ends_on,
                       COALESCE(lifecycle.status_at_date, CASE WHEN ce.ends_on IS NOT NULL AND @date>ce.ends_on THEN 'ended' WHEN ce.status='paused' AND @date>=CURRENT_DATE THEN 'paused' ELSE 'active' END) AS enrollment_status_at_date,
                       ROW_NUMBER() OVER (
                         PARTITION BY s.id
                         ORDER BY (sa.id IS NOT NULL) DESC,
                                  (ce.starts_on<=@date AND (ce.ends_on IS NULL OR ce.ends_on>=@date) AND attendance_circle.starts_on<=@date
                                    AND public.dar_enrollment_is_attendance_eligible_on_date(ce.id,@date)) DESC,
                                  (ce.status='active') DESC, ce.starts_on DESC, ce.created_at DESC, ce.id DESC
                       ) AS student_row
                FROM circle_schedule_slots ss
                JOIN circle_enrollments ce ON ce.circle_id=ss.circle_id AND ce.is_trashed=FALSE
                JOIN circles attendance_circle ON attendance_circle.id=ss.circle_id AND attendance_circle.is_trashed=FALSE
                JOIN students s ON s.id=ce.student_id AND s.is_trashed=FALSE
                LEFT JOIN student_attendance sa ON sa.enrollment_id=ce.id AND sa.schedule_slot_id=ss.id AND sa.session_date=@date AND sa.is_trashed=FALSE
                LEFT JOIN LATERAL (SELECT public.dar_enrollment_status_at_date(ce.id,@date) AS status_at_date) lifecycle ON TRUE
                WHERE ss.id=@slot AND ss.is_trashed=FALSE
            )
            SELECT enrollment_id,student_id,student_code,full_name,status,note,eligible_for_date,eligibility_reason,starts_on,ends_on,enrollment_status_at_date
            FROM candidates WHERE student_row=1
            ORDER BY eligible_for_date DESC,full_name;
            """, connection);
        command.Parameters.AddWithValue("slot", session.SlotId);
        command.Parameters.AddWithValue("date", session.Date);
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                rows.Add(new
                {
                    enrollmentId = reader.GetGuid(0),
                    studentId = reader.GetGuid(1),
                    studentCode = reader.GetString(2),
                    studentName = reader.GetString(3),
                    status = reader.IsDBNull(4) ? null : reader.GetString(4),
                    note = reader.IsDBNull(5) ? null : reader.GetString(5),
                    eligibleForDate = reader.GetBoolean(6),
                    eligibilityReason = reader.IsDBNull(7) ? null : reader.GetString(7),
                    startsOn = reader.GetFieldValue<DateOnly>(8),
                    endsOn = reader.IsDBNull(9) ? (DateOnly?)null : reader.GetFieldValue<DateOnly>(9),
                    enrollmentStatus = reader.GetString(10)
                });
            }
        }

        return Results.Ok(new { sessionId = id, date = session.Date, slotId = session.SlotId, students = rows });
    }

    public static async Task<IResult> Submit(
        Guid id,
        SubmitAttendanceRequest request,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var teacherId = TeachingPrincipal.TeacherId(principal);
        var userId = TeachingPrincipal.UserId(principal);
        if (teacherId == Guid.Empty || userId == Guid.Empty)
            return Results.Json(new { message = "هذا الحساب غير مرتبط بمعلمة. راجع المدير." }, statusCode: StatusCodes.Status403Forbidden);

        if (request.Students is null || request.Students.Length == 0)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["students"] = ["أرسل حالة كل طالبة."] });

        var allowed = new HashSet<string>(StringComparer.Ordinal) { "present", "excused", "absent" };
        if (request.Students.Any(x => !allowed.Contains(x.Status)))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["students"] = ["الحالة يجب أن تكون حاضر أو بعذر أو غائب."] });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        var session = await LoadSessionAsync(connection, transaction, id, teacherId, ct);
        if (session is null) return Results.NotFound(new { message = "الحلقة غير موجودة." });
        if (session.Status == "in_progress")
            return Results.Conflict(new { message = "أنهي الحلقة أولًا ثم سجّلي الحضور." });
        if (session.Status == "completed")
            return Results.Conflict(new { message = "تم تسليم حضور هذه الحلقة بالفعل." });

        var eligible = new HashSet<Guid>();
        await using (var query = new NpgsqlCommand("""
            SELECT ce.id
            FROM circle_enrollments ce
            JOIN students s ON s.id=ce.student_id AND s.is_trashed=FALSE
            WHERE ce.circle_id=@circle AND ce.is_trashed=FALSE
              AND ce.starts_on<=@date AND (ce.ends_on IS NULL OR ce.ends_on>=@date)
              AND public.dar_enrollment_is_attendance_eligible_on_date(ce.id,@date);
            """, connection, transaction))
        {
            query.Parameters.AddWithValue("circle", session.CircleId);
            query.Parameters.AddWithValue("date", session.Date);
            await using var reader = await query.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) eligible.Add(reader.GetGuid(0));
        }

        var submitted = request.Students.Select(x => x.EnrollmentId).ToHashSet();
        var missing = eligible.Except(submitted).ToArray();
        var unexpected = submitted.Except(eligible).ToArray();
        if (missing.Length > 0 || unexpected.Length > 0)
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["missing"] = missing.Select(x => x.ToString()).ToArray(),
                ["unexpected"] = unexpected.Select(x => x.ToString()).ToArray()
            });

        var present = 0;
        var excused = 0;
        var absent = 0;
        foreach (var mark in request.Students)
        {
            Guid attendanceId;
            await using (var upsert = new NpgsqlCommand("""
                INSERT INTO student_attendance(schedule_slot_id, enrollment_id, session_date, status, note, marked_by)
                VALUES (@slot, @enrollment, @date, @status, @note, @user)
                ON CONFLICT (schedule_slot_id, session_date, enrollment_id) WHERE is_trashed = FALSE
                DO UPDATE SET status=EXCLUDED.status, note=EXCLUDED.note, marked_by=EXCLUDED.marked_by, marked_at=now(), is_trashed=FALSE
                RETURNING id;
                """, connection, transaction))
            {
                upsert.Parameters.AddWithValue("slot", session.SlotId);
                upsert.Parameters.AddWithValue("enrollment", mark.EnrollmentId);
                upsert.Parameters.AddWithValue("date", session.Date);
                upsert.Parameters.AddWithValue("status", mark.Status);
                TeachingNotifications.AddNullable(upsert, "note", mark.Note?.Trim());
                upsert.Parameters.AddWithValue("user", userId);
                attendanceId = (Guid)(await upsert.ExecuteScalarAsync(ct) ?? Guid.Empty);
            }

            if (mark.Status == "present")
            {
                present++;
                await TeachingNotifications.ResolveAsync(connection, transaction, $"absence:{attendanceId}", userId, "تم تسجيل الطالبة حاضرة.", ct);
            }
            else
            {
                if (mark.Status == "excused") excused++; else absent++;
                var studentName = await StudentNameAsync(connection, transaction, mark.EnrollmentId, ct);
                await TeachingNotifications.OpenAsync(connection, transaction, null, "supervisor", "attendance", "warning",
                    mark.Status == "excused" ? "طالبة غائبة بعذر" : "طالبة غائبة بدون عذر",
                    $"{studentName} — {session.Date:yyyy-MM-dd}. تحتاج متابعة.",
                    "student_attendance", attendanceId, "/supervisor/absences", $"absence:{attendanceId}", ct);
            }
        }

        await using (var complete = new NpgsqlCommand("""
            UPDATE teacher_sessions SET status='completed', updated_at=now() WHERE id=@id;
            """, connection, transaction))
        {
            complete.Parameters.AddWithValue("id", id);
            await complete.ExecuteNonQueryAsync(ct);
        }

        await TeachingNotifications.ResolveAsync(connection, transaction, $"missing-attendance:{id}", userId, "تم تسليم حضور الطالبات.", ct);
        await TeachingAudit.WriteAsync(connection, transaction, principal, "teacher.attendance.submit", "teacher_session", id,
            new { present, excused, absent, total = request.Students.Length }, $"/api/v1/teacher/sessions/{id}/attendance", "POST", ct);
        await transaction.CommitAsync(ct);

        return Results.Ok(new { sessionId = id, status = "completed", present, excused, absent, total = request.Students.Length });
    }

    private static async Task<string> StudentNameAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid enrollmentId,
        CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("""
            SELECT s.full_name FROM circle_enrollments ce JOIN students s ON s.id=ce.student_id WHERE ce.id=@id;
            """, connection, transaction);
        command.Parameters.AddWithValue("id", enrollmentId);
        return (string?)await command.ExecuteScalarAsync(ct) ?? "طالبة";
    }
}
