using System.Security.Claims;
using Npgsql;
using Dar.Common.Pagination;
using Dar.Modules.Teaching.Features.Shared;

namespace Dar.Modules.Teaching.Features.Supervisor;

public static class AbsencesEndpoint
{
    public static async Task<IResult> Handle(
        string? date,
        int? page,
        int? pageSize,
        HttpContext http,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var today = CairoTime.Today();
        DateOnly day;
        if (string.IsNullOrWhiteSpace(date))
            day = today;
        else if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", out day))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["date"] = ["حدد التاريخ بصيغة YYYY-MM-DD."] });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);
        var paging = new PageRequest(page, pageSize);
        var paged = page is not null || pageSize is not null;

        var students = new List<object>();
        long total = 0;
        await using (var command = new NpgsqlCommand("""
            SELECT sa.id, sa.session_date, s.full_name, s.student_code, s.guardian_phone,
                   c.name, COALESCE(t.full_name, ''), sa.status, sa.note, sa.marked_at, s.id,
                   COUNT(*) OVER() AS total
            FROM student_attendance sa
            JOIN circle_enrollments ce ON ce.id = sa.enrollment_id
            JOIN students s ON s.id = ce.student_id AND s.is_trashed = FALSE
            JOIN circles c ON c.id = ce.circle_id AND c.is_trashed = FALSE
            LEFT JOIN teachers t ON t.id = c.teacher_id
            WHERE sa.session_date = @date AND sa.is_trashed = FALSE
              AND sa.status IN ('absent', 'excused')
              AND (@all OR c.id = ANY(@circles))
            ORDER BY c.name, s.full_name
            LIMIT @take OFFSET @skip;
            """, connection))
        {
            command.Parameters.AddWithValue("date", day);
            command.Parameters.AddWithValue("all", scope.All);
            command.Parameters.AddWithValue("circles", scope.CircleIds);
            command.Parameters.AddWithValue("take", paged ? paging.PageSize : 500);
            command.Parameters.AddWithValue("skip", paged ? paging.Offset : 0L);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                total = reader.GetInt64(11);
                students.Add(new
                {
                    attendanceId = reader.GetGuid(0),
                    date = reader.GetFieldValue<DateOnly>(1),
                    studentId = reader.GetGuid(10),
                    studentName = reader.GetString(2),
                    studentCode = reader.GetString(3),
                    guardianPhone = reader.IsDBNull(4) ? null : reader.GetString(4),
                    circleName = reader.GetString(5),
                    teacherName = reader.GetString(6),
                    status = reader.GetString(7),
                    note = reader.IsDBNull(8) ? null : reader.GetString(8),
                    markedAt = reader.GetFieldValue<DateTimeOffset>(9)
                });
            }
        }

        var teachers = new List<object>();
        await using (var teacherCommand = new NpgsqlCommand("""
            SELECT t.id, t.full_name, t.phone, c.id, c.name, ss.id,
                   ss.starts_at, ss.duration_minutes
            FROM circle_schedule_slots ss
            JOIN circles c ON c.id = ss.circle_id AND c.is_trashed = FALSE AND c.is_active = TRUE
            JOIN teachers t ON t.id = c.teacher_id AND t.is_trashed = FALSE AND t.status = 'active'
            WHERE ss.is_active = TRUE AND ss.is_trashed = FALSE
              AND ss.day_of_week = EXTRACT(DOW FROM @date::date)::int
              AND (@all OR c.id = ANY(@circles))
              AND @date <= @today
              AND (@date < @today OR @now >= (ss.starts_at + (ss.duration_minutes || ' minutes')::interval)::time)
              AND NOT EXISTS (
                  SELECT 1 FROM teacher_attendance ta
                  WHERE ta.schedule_slot_id = ss.id AND ta.session_date = @date AND ta.is_trashed = FALSE
              )
            ORDER BY ss.starts_at, t.full_name
            LIMIT 300;
            """, connection))
        {
            teacherCommand.Parameters.AddWithValue("date", day);
            teacherCommand.Parameters.AddWithValue("today", today);
            teacherCommand.Parameters.AddWithValue("now", CairoTime.NowTime());
            teacherCommand.Parameters.AddWithValue("all", scope.All);
            teacherCommand.Parameters.AddWithValue("circles", scope.CircleIds);
            await using var reader = await teacherCommand.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                teachers.Add(new
                {
                    teacherId = reader.GetGuid(0),
                    teacherName = reader.GetString(1),
                    phone = reader.IsDBNull(2) ? null : reader.GetString(2),
                    circleId = reader.GetGuid(3),
                    circleName = reader.GetString(4),
                    scheduleSlotId = reader.GetGuid(5),
                    startsAt = reader.GetFieldValue<TimeOnly>(6).ToString("HH:mm"),
                    durationMinutes = reader.GetInt32(7)
                });
            }
        }

        PaginationHeaders.Apply(http.Response, total, paging, students.Count);
        return Results.Ok(new
        {
            date = day,
            absences = students,
            students,
            teachers,
            counts = new { students = students.Count, teachers = teachers.Count }
        });
    }
}
