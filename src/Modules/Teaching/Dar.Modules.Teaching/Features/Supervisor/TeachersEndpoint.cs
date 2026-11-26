using System.Security.Claims;
using Npgsql;
using Dar.Common.Pagination;
using Dar.Modules.Teaching.Features.Shared;

namespace Dar.Modules.Teaching.Features.Supervisor;

public static class TeachersEndpoint
{
    public static async Task<IResult> List(
        string? search,
        int? page,
        int? pageSize,
        HttpContext http,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);
        var canFinance = TeachingPrincipal.Has(principal, "finance.read");
        var today = CairoTime.Today();
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        var term = (search ?? string.Empty).Trim();
        var like = $"%{term}%";
        var paging = new PageRequest(page, pageSize);
        var paged = page is not null || pageSize is not null;
        var take = paged ? paging.PageSize : 300;

        await using var command = new NpgsqlCommand("""
            SELECT t.id, t.full_name, t.phone, t.status,
                   CASE WHEN @finance THEN t.hourly_rate ELSE NULL END,
                   (SELECT COUNT(*) FROM circles c
                     WHERE c.teacher_id = t.id AND c.is_trashed = FALSE) AS circle_count,
                   (SELECT COUNT(DISTINCT ce.student_id)
                      FROM circle_enrollments ce
                      JOIN circles c ON c.id = ce.circle_id
                     WHERE c.teacher_id = t.id AND c.is_trashed = FALSE
                       AND ce.is_trashed = FALSE AND ce.status = 'active') AS student_count,
                   (SELECT COUNT(*) FROM teacher_attendance ta
                     WHERE ta.teacher_id = t.id AND ta.is_trashed = FALSE
                       AND ta.session_date BETWEEN @from AND @to
                       AND ta.status = 'present') AS present_count,
                   (SELECT COUNT(*) FROM teacher_attendance ta
                     WHERE ta.teacher_id = t.id AND ta.is_trashed = FALSE
                       AND ta.session_date BETWEEN @from AND @to
                       AND ta.status IN ('absent', 'cancelled')) AS missed_count,
                   COUNT(*) OVER() AS total
            FROM teachers t
            WHERE t.is_trashed = FALSE
              AND (@all OR t.id = ANY(@teachers))
              AND (@search = '' OR t.full_name ILIKE @like OR COALESCE(t.phone, '') ILIKE @like)
            ORDER BY t.full_name
            LIMIT @take OFFSET @skip;
            """, connection);
        command.Parameters.AddWithValue("finance", canFinance);
        command.Parameters.AddWithValue("all", scope.All);
        command.Parameters.AddWithValue("teachers", scope.TeacherIds);
        command.Parameters.AddWithValue("search", term);
        command.Parameters.AddWithValue("like", like);
        command.Parameters.AddWithValue("from", monthStart);
        command.Parameters.AddWithValue("to", today);
        command.Parameters.AddWithValue("take", take);
        command.Parameters.AddWithValue("skip", paged ? paging.Offset : 0L);

        var teachers = new List<object>();
        long total = 0;
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            total = reader.GetInt64(9);
            teachers.Add(new
            {
                id = reader.GetGuid(0),
                fullName = reader.GetString(1),
                phone = reader.IsDBNull(2) ? null : reader.GetString(2),
                status = reader.GetString(3),
                hourlyRate = reader.IsDBNull(4) ? (decimal?)null : reader.GetDecimal(4),
                circleCount = (int)reader.GetInt64(5),
                studentCount = (int)reader.GetInt64(6),
                presentThisMonth = (int)reader.GetInt64(7),
                missedThisMonth = (int)reader.GetInt64(8)
            });
        }

        PaginationHeaders.Apply(http.Response, total, paging, teachers.Count);
        return Results.Ok(new { count = teachers.Count, month = monthStart, teachers });
    }

    public static async Task<IResult> Detail(
        Guid id,
        DateOnly? from,
        DateOnly? to,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var today = CairoTime.Today();
        var start = from ?? new DateOnly(today.Year, today.Month, 1);
        var end = to ?? today;
        if (end < start || end.DayNumber - start.DayNumber > 366)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["date"] = ["اختر فترة صحيحة لا تتجاوز سنة."] });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);
        var canFinance = TeachingPrincipal.Has(principal, "finance.read");

        Guid teacherId;
        string name, status;
        string? phone;
        decimal? hourlyRate;

        await using (var teacher = new NpgsqlCommand("""
            SELECT t.id, t.full_name, t.phone, t.status,
                   CASE WHEN @finance THEN t.hourly_rate ELSE NULL END
            FROM teachers t
            WHERE t.id = @id AND t.is_trashed = FALSE
              AND (@all OR t.id = ANY(@teachers));
            """, connection))
        {
            teacher.Parameters.AddWithValue("id", id);
            teacher.Parameters.AddWithValue("finance", canFinance);
            teacher.Parameters.AddWithValue("all", scope.All);
            teacher.Parameters.AddWithValue("teachers", scope.TeacherIds);
            await using var reader = await teacher.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
                return Results.NotFound(new { message = "المعلمة غير موجودة داخل نطاقك." });
            teacherId = reader.GetGuid(0);
            name = reader.GetString(1);
            phone = reader.IsDBNull(2) ? null : reader.GetString(2);
            status = reader.GetString(3);
            hourlyRate = reader.IsDBNull(4) ? null : reader.GetDecimal(4);
        }

        var circles = new List<object>();
        await using (var circleCommand = new NpgsqlCommand("""
            SELECT c.id, c.name, c.is_active,
                   (SELECT COUNT(*) FROM circle_enrollments ce
                     WHERE ce.circle_id = c.id AND ce.is_trashed = FALSE AND ce.status = 'active') AS students
            FROM circles c
            WHERE c.teacher_id = @id AND c.is_trashed = FALSE
              AND (@all OR c.id = ANY(@circles))
            ORDER BY c.name;
            """, connection))
        {
            circleCommand.Parameters.AddWithValue("id", id);
            circleCommand.Parameters.AddWithValue("all", scope.All);
            circleCommand.Parameters.AddWithValue("circles", scope.CircleIds);
            await using var reader = await circleCommand.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                circles.Add(new
                {
                    id = reader.GetGuid(0),
                    name = reader.GetString(1),
                    isActive = reader.GetBoolean(2),
                    studentCount = (int)reader.GetInt64(3)
                });
        }

        int present, absent, cancelled, minutes, overtime, undertime, scheduled;
        await using (var summary = new NpgsqlCommand("""
            SELECT COUNT(*) FILTER (WHERE ta.status = 'present'),
                   COUNT(*) FILTER (WHERE ta.status = 'absent'),
                   COUNT(*) FILTER (WHERE ta.status = 'cancelled'),
                   COALESCE(SUM(ta.duration_minutes) FILTER (WHERE ta.status = 'present'), 0),
                   COALESCE(SUM(ta.overtime_minutes) FILTER (WHERE ta.status = 'present'), 0),
                   COALESCE(SUM(ta.undertime_minutes) FILTER (WHERE ta.status = 'present'), 0)
            FROM teacher_attendance ta
            WHERE ta.teacher_id = @id AND ta.is_trashed = FALSE
              AND ta.session_date BETWEEN @from AND @to;
            """, connection))
        {
            summary.Parameters.AddWithValue("id", id);
            summary.Parameters.AddWithValue("from", start);
            summary.Parameters.AddWithValue("to", end);
            await using var reader = await summary.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            present = (int)reader.GetInt64(0);
            absent = (int)reader.GetInt64(1);
            cancelled = (int)reader.GetInt64(2);
            minutes = (int)reader.GetInt64(3);
            overtime = (int)reader.GetInt64(4);
            undertime = (int)reader.GetInt64(5);
        }

        await using (var scheduledCommand = new NpgsqlCommand("""
            SELECT COUNT(*)
            FROM circle_schedule_slots ss
            JOIN circles c ON c.id = ss.circle_id AND c.is_trashed = FALSE AND c.is_active = TRUE
            CROSS JOIN LATERAL generate_series(@from::date, @to::date, interval '1 day') AS d(day)
            WHERE c.teacher_id = @id
              AND ss.is_active = TRUE AND ss.is_trashed = FALSE
              AND ss.day_of_week = EXTRACT(DOW FROM d.day)::int
              AND d.day::date >= c.starts_on
              AND d.day::date <= @today;
            """, connection))
        {
            scheduledCommand.Parameters.AddWithValue("id", id);
            scheduledCommand.Parameters.AddWithValue("from", start);
            scheduledCommand.Parameters.AddWithValue("to", end);
            scheduledCommand.Parameters.AddWithValue("today", today);
            scheduled = Convert.ToInt32(await scheduledCommand.ExecuteScalarAsync(ct) ?? 0);
        }

        var history = new List<object>();
        await using (var historyCommand = new NpgsqlCommand("""
            SELECT ta.id, ta.session_date, c.name, COALESCE(ss.starts_at, '00:00'::time), ta.status,
                   ta.duration_minutes, ta.actual_duration_minutes, ta.overtime_minutes, ta.undertime_minutes,
                   ta.note,
                   CASE WHEN @finance THEN ta.payable_amount ELSE NULL END,
                   (SELECT COUNT(*) FROM student_attendance sa
                     WHERE sa.schedule_slot_id = ta.schedule_slot_id AND sa.session_date = ta.session_date
                       AND sa.is_trashed = FALSE AND sa.status = 'present') AS present_students,
                   (SELECT COUNT(*) FROM student_attendance sa
                     WHERE sa.schedule_slot_id = ta.schedule_slot_id AND sa.session_date = ta.session_date
                       AND sa.is_trashed = FALSE AND sa.status = 'absent') AS absent_students
            FROM teacher_attendance ta
            JOIN circles c ON c.id = ta.circle_id
            LEFT JOIN circle_schedule_slots ss ON ss.id = ta.schedule_slot_id
            WHERE ta.teacher_id = @id AND ta.is_trashed = FALSE
              AND ta.session_date BETWEEN @from AND @to
            ORDER BY ta.session_date DESC, ss.starts_at DESC
            LIMIT 120;
            """, connection))
        {
            historyCommand.Parameters.AddWithValue("id", id);
            historyCommand.Parameters.AddWithValue("finance", canFinance);
            historyCommand.Parameters.AddWithValue("from", start);
            historyCommand.Parameters.AddWithValue("to", end);
            await using var reader = await historyCommand.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                history.Add(new
                {
                    id = reader.GetGuid(0),
                    date = reader.GetFieldValue<DateOnly>(1),
                    circleName = reader.GetString(2),
                    startsAt = reader.GetFieldValue<TimeOnly>(3).ToString("HH:mm"),
                    status = reader.GetString(4),
                    durationMinutes = reader.GetInt32(5),
                    actualMinutes = reader.IsDBNull(6) ? (int?)null : reader.GetInt32(6),
                    overtimeMinutes = reader.GetInt32(7),
                    undertimeMinutes = reader.GetInt32(8),
                    note = reader.IsDBNull(9) ? null : reader.GetString(9),
                    payableAmount = reader.IsDBNull(10) ? (decimal?)null : reader.GetDecimal(10),
                    presentStudents = (int)reader.GetInt64(11),
                    absentStudents = (int)reader.GetInt64(12)
                });
            }
        }

        var notes = new List<object>();
        await using (var notesCommand = new NpgsqlCommand("""
            SELECT tn.id, tn.note_text, tn.created_at, u.display_name
            FROM teacher_notes tn
            LEFT JOIN app_users u ON u.id = tn.created_by
            WHERE tn.teacher_id = @id AND tn.is_trashed = FALSE
            ORDER BY tn.created_at DESC
            LIMIT 40;
            """, connection))
        {
            notesCommand.Parameters.AddWithValue("id", id);
            await using var reader = await notesCommand.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                notes.Add(new
                {
                    id = reader.GetGuid(0),
                    text = reader.GetString(1),
                    createdAt = reader.GetFieldValue<DateTimeOffset>(2),
                    createdBy = reader.IsDBNull(3) ? null : reader.GetString(3)
                });
            }
        }

        return Results.Ok(new
        {
            teacher = new
            {
                id = teacherId,
                fullName = name,
                phone,
                status,
                hourlyRate
            },
            period = new { from = start, to = end },
            attendance = new
            {
                scheduled,
                present,
                absent,
                cancelled,
                rate = scheduled == 0 ? (double?)null : Math.Round(present * 100.0 / scheduled, 1),
                hours = Math.Round(minutes / 60.0, 1),
                overtimeMinutes = overtime,
                undertimeMinutes = undertime
            },
            circles,
            history,
            notes
        });
    }
}
