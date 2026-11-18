using System.Globalization;
using System.Security.Claims;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Teacher;

public static class TeacherCalendarEndpoints
{
    public static async Task<IResult> Calendar(
        string? from,
        int? days,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var teacherId = TeachingPrincipal.TeacherId(principal);
        if (teacherId == Guid.Empty)
            return Results.Json(new { message = "هذا الحساب غير مرتبط بمعلمة. راجع المدير." }, statusCode: StatusCodes.Status403Forbidden);

        var rangeDays = days ?? 7;
        if (rangeDays is < 1 or > 31)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["days"] = ["المدة يجب أن تكون من 1 إلى 31 يومًا."] });

        var start = CairoTime.Today();
        if (!string.IsNullOrWhiteSpace(from) && !DateOnly.TryParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out start))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["from"] = ["حدد بداية الأسبوع بصيغة YYYY-MM-DD."] });
        var end = start.AddDays(rangeDays - 1);

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            WITH days AS (
                SELECT generate_series(@from::date, @to::date, interval '1 day')::date AS session_date
            )
            SELECT d.session_date, EXTRACT(DOW FROM d.session_date)::int,
                   ss.id, c.id, c.name, ss.starts_at, ss.duration_minutes,
                   (SELECT COUNT(*) FROM circle_enrollments ce
                     WHERE ce.circle_id=c.id AND ce.status='active' AND ce.is_trashed=FALSE),
                   ts.id, ts.status, ts.started_at, ts.ended_at,
                   ts.actual_duration_minutes, ts.payable_duration_minutes, ts.pay_basis, ts.note,
                   ta.id
            FROM days d
            JOIN circle_schedule_slots ss
              ON ss.day_of_week=EXTRACT(DOW FROM d.session_date)::smallint
             AND ss.is_active=TRUE AND ss.is_trashed=FALSE
            JOIN circles c ON c.id=ss.circle_id AND c.teacher_id=@teacher
                 AND c.is_trashed=FALSE AND c.is_active=TRUE
            LEFT JOIN teacher_sessions ts ON ts.schedule_slot_id=ss.id AND ts.session_date=d.session_date
            LEFT JOIN teacher_attendance ta ON ta.schedule_slot_id=ss.id AND ta.session_date=d.session_date AND ta.is_trashed=FALSE
            ORDER BY d.session_date, ss.starts_at;
            """, connection);
        command.Parameters.AddWithValue("from", start);
        command.Parameters.AddWithValue("to", end);
        command.Parameters.AddWithValue("teacher", teacherId);

        var daysMap = new Dictionary<DateOnly, List<object>>();
        for (var date = start; date <= end; date = date.AddDays(1)) daysMap[date] = [];
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                var date = reader.GetFieldValue<DateOnly>(0);
                if (!daysMap.TryGetValue(date, out var sessions)) continue;
                sessions.Add(new
                {
                    slotId = reader.GetGuid(2),
                    circleId = reader.GetGuid(3),
                    circleName = reader.GetString(4),
                    startsAt = reader.GetFieldValue<TimeOnly>(5).ToString("HH:mm"),
                    durationMinutes = reader.GetInt32(6),
                    studentCount = reader.GetInt64(7),
                    sessionId = reader.IsDBNull(8) ? (Guid?)null : reader.GetGuid(8),
                    sessionStatus = reader.IsDBNull(9) ? null : reader.GetString(9),
                    startedAt = reader.IsDBNull(10) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(10),
                    endedAt = reader.IsDBNull(11) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(11),
                    actualMinutes = reader.IsDBNull(12) ? (int?)null : reader.GetInt32(12),
                    payableMinutes = reader.IsDBNull(13) ? (int?)null : reader.GetInt32(13),
                    payBasis = reader.IsDBNull(14) ? null : reader.GetString(14),
                    note = reader.IsDBNull(15) ? null : reader.GetString(15),
                    attendanceId = reader.IsDBNull(16) ? (Guid?)null : reader.GetGuid(16)
                });
            }
        }

        var calendarDays = daysMap.Select(pair => new
        {
            date = pair.Key,
            dayOfWeek = (int)pair.Key.DayOfWeek,
            sessions = pair.Value
        });

        return Results.Ok(new { from = start, to = end, days = calendarDays });
    }

    public static async Task<IResult> History(
        int? limit,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var teacherId = TeachingPrincipal.TeacherId(principal);
        var userId = TeachingPrincipal.UserId(principal);
        if (teacherId == Guid.Empty)
            return Results.Json(new { message = "هذا الحساب غير مرتبط بمعلمة. راجع المدير." }, statusCode: StatusCodes.Status403Forbidden);

        var take = Math.Clamp(limit ?? 50, 1, 100);
        var today = CairoTime.Today();
        var canSeeEarnings = TeachingPrincipal.Has(principal, "teacher.earnings.self");
        await using var connection = await dataSource.OpenConnectionAsync(ct);

        var sessions = new List<object>();
        await using (var command = new NpgsqlCommand("""
            SELECT ts.id, ts.session_date, c.name, ts.status, ts.started_at, ts.ended_at,
                   ts.scheduled_duration_minutes, ts.actual_duration_minutes, ts.payable_duration_minutes,
                   ts.pay_basis, ts.overtime_minutes, ts.undertime_minutes, ts.note,
                   (SELECT COUNT(*) FROM student_attendance sa
                     JOIN circle_enrollments ce ON ce.id=sa.enrollment_id
                     WHERE ce.circle_id=ts.circle_id AND sa.schedule_slot_id=ts.schedule_slot_id
                       AND sa.session_date=ts.session_date AND sa.is_trashed=FALSE AND sa.status='present'),
                   (SELECT COUNT(*) FROM circle_enrollments ce
                     WHERE ce.circle_id=ts.circle_id AND ce.status='active' AND ce.is_trashed=FALSE)
            FROM teacher_sessions ts
            JOIN circles c ON c.id=ts.circle_id AND c.is_trashed=FALSE
            WHERE ts.teacher_id=@teacher AND ts.session_date<=@today
            ORDER BY ts.session_date DESC, ts.started_at DESC
            LIMIT @take;
            """, connection))
        {
            command.Parameters.AddWithValue("teacher", teacherId);
            command.Parameters.AddWithValue("today", today);
            command.Parameters.AddWithValue("take", take);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                sessions.Add(new
                {
                    id = reader.GetGuid(0),
                    date = reader.GetFieldValue<DateOnly>(1),
                    circleName = reader.GetString(2),
                    status = reader.GetString(3),
                    startedAt = reader.GetFieldValue<DateTimeOffset>(4),
                    endedAt = reader.IsDBNull(5) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(5),
                    scheduledMinutes = reader.GetInt32(6),
                    actualMinutes = reader.IsDBNull(7) ? (int?)null : reader.GetInt32(7),
                    payableMinutes = reader.IsDBNull(8) ? (int?)null : reader.GetInt32(8),
                    payBasis = reader.IsDBNull(9) ? null : reader.GetString(9),
                    overtimeMinutes = reader.GetInt32(10),
                    undertimeMinutes = reader.GetInt32(11),
                    note = reader.IsDBNull(12) ? null : reader.GetString(12),
                    presentStudents = reader.GetInt64(13),
                    totalStudents = reader.GetInt64(14)
                });
            }
        }

        var attendance = new List<object>();
        await using (var command = new NpgsqlCommand("""
            SELECT ta.id, ta.session_date, c.name, ta.status, ta.duration_minutes, ta.payable_amount, ta.note, ta.marked_at
            FROM teacher_attendance ta
            JOIN circles c ON c.id=ta.circle_id AND c.is_trashed=FALSE
            WHERE ta.teacher_id=@teacher AND ta.session_date<=@today AND ta.is_trashed=FALSE
            ORDER BY ta.session_date DESC, ta.marked_at DESC
            LIMIT @take;
            """, connection))
        {
            command.Parameters.AddWithValue("teacher", teacherId);
            command.Parameters.AddWithValue("today", today);
            command.Parameters.AddWithValue("take", take);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                attendance.Add(new
                {
                    id = reader.GetGuid(0),
                    date = reader.GetFieldValue<DateOnly>(1),
                    circleName = reader.GetString(2),
                    status = reader.GetString(3),
                    durationMinutes = reader.GetInt32(4),
                    payableAmount = canSeeEarnings ? reader.GetDecimal(5) : (decimal?)null,
                    note = reader.IsDBNull(6) ? null : reader.GetString(6),
                    markedAt = reader.GetFieldValue<DateTimeOffset>(7)
                });
            }
        }

        var logins = new List<object>();
        if (userId != Guid.Empty)
        {
            await using var command = new NpgsqlCommand("""
                SELECT created_at, last_seen_at, ip, user_agent
                FROM auth_sessions WHERE user_id=@user ORDER BY created_at DESC LIMIT 5;
                """, connection);
            command.Parameters.AddWithValue("user", userId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                logins.Add(new
                {
                    createdAt = reader.GetFieldValue<DateTimeOffset>(0),
                    lastSeenAt = reader.IsDBNull(1) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(1),
                    ip = reader.IsDBNull(2) ? null : reader.GetString(2),
                    userAgent = reader.IsDBNull(3) ? null : reader.GetString(3)
                });
            }
        }

        return Results.Ok(new { sessions, attendance, logins });
    }
}
