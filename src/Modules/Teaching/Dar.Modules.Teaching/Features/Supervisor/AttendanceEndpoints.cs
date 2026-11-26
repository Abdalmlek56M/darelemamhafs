using System.Security.Claims;
using Npgsql;
using Dar.Common.Pagination;

namespace Dar.Modules.Teaching.Features.Supervisor;

public static class AttendanceEndpoints
{
    public static async Task<IResult> TeacherAttendance(
        string? date,
        Guid? circleId,
        int? page,
        int? pageSize,
        HttpContext http,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var today = CairoTime.Today();
        DateOnly day;
        if (string.IsNullOrWhiteSpace(date)) day = today;
        else if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", out day))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["date"] = ["حدد التاريخ بصيغة YYYY-MM-DD."] });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);
        if (circleId is not null && !scope.AllowsCircle(circleId.Value))
            return Results.Json(new { message = "هذه الحلقة خارج نطاقك." }, statusCode: StatusCodes.Status403Forbidden);

        var paging = new PageRequest(page, pageSize);
        var paged = page is not null || pageSize is not null;
        var rows = new List<object>();
        long total = 0;
        await using var command = new NpgsqlCommand("""
            SELECT ss.id, c.id, c.name, t.id, t.full_name, ss.starts_at, ss.duration_minutes,
                   ta.id, ta.status, ta.duration_minutes, ta.actual_duration_minutes,
                   ta.overtime_minutes, ta.undertime_minutes, ta.note, COUNT(*) OVER() AS total
            FROM circle_schedule_slots ss
            JOIN circles c ON c.id = ss.circle_id AND c.is_trashed = FALSE AND c.is_active = TRUE
            JOIN teachers t ON t.id = c.teacher_id AND t.is_trashed = FALSE
            LEFT JOIN teacher_attendance ta ON ta.schedule_slot_id = ss.id
                 AND ta.session_date = @date AND ta.is_trashed = FALSE
            WHERE ss.is_active = TRUE AND ss.is_trashed = FALSE
              AND ss.day_of_week = EXTRACT(DOW FROM @date::date)::int
              AND (@all OR c.id = ANY(@circles))
              AND (@circle::uuid IS NULL OR c.id = @circle)
            ORDER BY ss.starts_at, c.name, ss.id
            LIMIT @take OFFSET @skip;
            """, connection);
        command.Parameters.AddWithValue("date", day);
        command.Parameters.AddWithValue("all", scope.All);
        command.Parameters.AddWithValue("circles", scope.CircleIds);
        command.Parameters.AddWithValue("circle", (object?)circleId ?? DBNull.Value);
        command.Parameters.AddWithValue("take", paged ? paging.PageSize : 500);
        command.Parameters.AddWithValue("skip", paged ? paging.Offset : 0L);

        var now = CairoTime.NowTime();
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                total = reader.ReadTotal();
                var startsAt = reader.GetFieldValue<TimeOnly>(5);
                var duration = reader.GetInt32(6);
                var isPast = day < today || (day == today && now >= startsAt.AddMinutes(duration));
                rows.Add(new
                {
                    scheduleSlotId = reader.GetGuid(0),
                    circleId = reader.GetGuid(1),
                    circleName = reader.GetString(2),
                    teacherId = reader.GetGuid(3),
                    teacherName = reader.GetString(4),
                    startsAt = startsAt.ToString("HH:mm"),
                    durationMinutes = duration,
                    attendanceId = reader.IsDBNull(7) ? (Guid?)null : reader.GetGuid(7),
                    status = reader.IsDBNull(8) ? (isPast ? "missing" : "scheduled") : reader.GetString(8),
                    payableMinutes = reader.IsDBNull(9) ? (int?)null : reader.GetInt32(9),
                    actualMinutes = reader.IsDBNull(10) ? (int?)null : reader.GetInt32(10),
                    overtimeMinutes = reader.IsDBNull(11) ? 0 : reader.GetInt32(11),
                    undertimeMinutes = reader.IsDBNull(12) ? 0 : reader.GetInt32(12),
                    note = reader.IsDBNull(13) ? null : reader.GetString(13)
                });
            }
        }

        total = await PaginationRules.EnsureTotalAsync(command, total, paged, ct);
        PaginationHeaderWriter.Write(http.Response, total, paging, rows.Count, paged);
        return Results.Ok(new { date = day, count = rows.Count, sessions = rows });
    }

    public static async Task<IResult> StudentAttendance(
        string? date,
        Guid? circleId,
        string? search,
        int? page,
        int? pageSize,
        HttpContext http,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var today = CairoTime.Today();
        DateOnly day;
        if (string.IsNullOrWhiteSpace(date)) day = today;
        else if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", out day))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["date"] = ["حدد التاريخ بصيغة YYYY-MM-DD."] });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);
        if (circleId is not null && !scope.AllowsCircle(circleId.Value))
            return Results.Json(new { message = "هذه الحلقة خارج نطاقك." }, statusCode: StatusCodes.Status403Forbidden);

        var term = (search ?? string.Empty).Trim();
        var paging = new PageRequest(page, pageSize);
        var paged = page is not null || pageSize is not null;
        var rows = new List<object>();
        long total = 0;
        await using var command = new NpgsqlCommand("""
            SELECT sa.id, sa.session_date, s.id, s.student_code, s.full_name,
                   c.id, c.name, COALESCE(ss.starts_at, '00:00'::time), sa.status, sa.note,
                   COUNT(*) OVER() AS total
            FROM student_attendance sa
            JOIN circle_enrollments ce ON ce.id = sa.enrollment_id
            JOIN students s ON s.id = ce.student_id AND s.is_trashed = FALSE
            JOIN circles c ON c.id = ce.circle_id AND c.is_trashed = FALSE
            LEFT JOIN circle_schedule_slots ss ON ss.id = sa.schedule_slot_id
            WHERE sa.session_date = @date AND sa.is_trashed = FALSE
              AND (@all OR c.id = ANY(@circles))
              AND (@circle::uuid IS NULL OR c.id = @circle)
              AND (@search = '' OR s.full_name ILIKE @like OR s.student_code ILIKE @like)
            ORDER BY c.name, s.full_name, sa.id
            LIMIT @take OFFSET @skip;
            """, connection);
        command.Parameters.AddWithValue("date", day);
        command.Parameters.AddWithValue("all", scope.All);
        command.Parameters.AddWithValue("circles", scope.CircleIds);
        command.Parameters.AddWithValue("circle", (object?)circleId ?? DBNull.Value);
        command.Parameters.AddWithValue("search", term);
        command.Parameters.AddWithValue("like", $"%{term}%");
        command.Parameters.AddWithValue("take", paged ? paging.PageSize : 1000);
        command.Parameters.AddWithValue("skip", paged ? paging.Offset : 0L);

        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                total = reader.ReadTotal();
                rows.Add(new
                {
                    attendanceId = reader.GetGuid(0),
                    date = reader.GetFieldValue<DateOnly>(1),
                    studentId = reader.GetGuid(2),
                    studentCode = reader.GetString(3),
                    studentName = reader.GetString(4),
                    circleId = reader.GetGuid(5),
                    circleName = reader.GetString(6),
                    startsAt = reader.GetFieldValue<TimeOnly>(7).ToString("HH:mm"),
                    status = reader.GetString(8),
                    note = reader.IsDBNull(9) ? null : reader.GetString(9)
                });
            }
        }

        total = await PaginationRules.EnsureTotalAsync(command, total, paged, ct);
        PaginationHeaderWriter.Write(http.Response, total, paging, rows.Count, paged);
        return Results.Ok(new { date = day, count = rows.Count, attendance = rows });
    }
}
