using System.Security.Claims;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Supervisor;

public static class CirclesEndpoint
{
    private sealed record CircleRow(
        Guid Id,
        string Name,
        Guid? TeacherId,
        string? TeacherName,
        bool IsActive,
        DateOnly StartsOn,
        decimal? MonthlyFee,
        int StudentCount);

    public static async Task<IResult> List(
        string? search,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);
        var canFinance = TeachingPrincipal.Has(principal, "finance.read");
        var term = (search ?? string.Empty).Trim();
        var like = $"%{term}%";

        var circles = new List<CircleRow>();
        await using (var command = new NpgsqlCommand("""
            SELECT c.id, c.name, c.teacher_id, t.full_name, c.is_active, c.starts_on,
                   CASE WHEN @finance THEN c.monthly_fee ELSE NULL END,
                   (SELECT COUNT(*) FROM circle_enrollments ce
                     WHERE ce.circle_id = c.id AND ce.is_trashed = FALSE AND ce.status = 'active') AS students
            FROM circles c
            LEFT JOIN teachers t ON t.id = c.teacher_id AND t.is_trashed = FALSE
            WHERE c.is_trashed = FALSE
              AND (@all OR c.id = ANY(@circles))
              AND (@search = '' OR c.name ILIKE @like OR COALESCE(t.full_name, '') ILIKE @like)
            ORDER BY c.name
            LIMIT 300;
            """, connection))
        {
            command.Parameters.AddWithValue("finance", canFinance);
            command.Parameters.AddWithValue("all", scope.All);
            command.Parameters.AddWithValue("circles", scope.CircleIds);
            command.Parameters.AddWithValue("search", term);
            command.Parameters.AddWithValue("like", like);

            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                circles.Add(new CircleRow(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetGuid(2),
                    reader.IsDBNull(3) ? null : reader.GetString(3),
                    reader.GetBoolean(4),
                    reader.GetFieldValue<DateOnly>(5),
                    reader.IsDBNull(6) ? null : reader.GetDecimal(6),
                    (int)reader.GetInt64(7)));
            }
        }

        var schedules = new Dictionary<Guid, List<object>>();
        if (circles.Count > 0)
        {
            await using var scheduleCommand = new NpgsqlCommand("""
                SELECT circle_id, day_of_week, starts_at, duration_minutes
                FROM circle_schedule_slots
                WHERE circle_id = ANY(@ids) AND is_active = TRUE AND is_trashed = FALSE
                ORDER BY day_of_week, starts_at;
                """, connection);
            scheduleCommand.Parameters.AddWithValue("ids", circles.Select(c => c.Id).ToArray());
            await using var reader = await scheduleCommand.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var id = reader.GetGuid(0);
                if (!schedules.TryGetValue(id, out var list))
                {
                    list = [];
                    schedules[id] = list;
                }
                list.Add(new
                {
                    dayOfWeek = reader.GetInt16(1),
                    startsAt = reader.GetFieldValue<TimeOnly>(2).ToString("HH:mm"),
                    durationMinutes = reader.GetInt32(3)
                });
            }
        }

        var result = circles.Select(circle =>
        {
            var schedule = schedules.GetValueOrDefault(circle.Id) ?? [];
            return new
            {
                id = circle.Id,
                name = circle.Name,
                teacherId = circle.TeacherId,
                teacherName = circle.TeacherName,
                isActive = circle.IsActive,
                startsOn = circle.StartsOn,
                monthlyFee = circle.MonthlyFee,
                studentCount = circle.StudentCount,
                schedule
            };
        }).ToArray();

        return Results.Ok(new { count = result.Length, circles = result });
    }

    public static async Task<IResult> Detail(
        Guid id,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);
        var canFinance = TeachingPrincipal.Has(principal, "finance.read");

        if (!scope.AllowsCircle(id))
            return Results.NotFound(new { message = "الحلقة غير موجودة داخل نطاقك." });

        Guid circleId;
        string name;
        Guid? teacherId;
        string? teacherName;
        bool isActive;
        DateOnly startsOn;
        decimal? monthlyFee;

        await using (var circle = new NpgsqlCommand("""
            SELECT c.id, c.name, c.teacher_id, t.full_name, c.is_active, c.starts_on,
                   CASE WHEN @finance THEN c.monthly_fee ELSE NULL END
            FROM circles c
            LEFT JOIN teachers t ON t.id = c.teacher_id AND t.is_trashed = FALSE
            WHERE c.id = @id AND c.is_trashed = FALSE;
            """, connection))
        {
            circle.Parameters.AddWithValue("id", id);
            circle.Parameters.AddWithValue("finance", canFinance);
            await using var reader = await circle.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
                return Results.NotFound(new { message = "الحلقة غير موجودة." });
            circleId = reader.GetGuid(0);
            name = reader.GetString(1);
            teacherId = reader.IsDBNull(2) ? null : reader.GetGuid(2);
            teacherName = reader.IsDBNull(3) ? null : reader.GetString(3);
            isActive = reader.GetBoolean(4);
            startsOn = reader.GetFieldValue<DateOnly>(5);
            monthlyFee = reader.IsDBNull(6) ? null : reader.GetDecimal(6);
        }

        var roster = new List<object>();
        await using (var rosterCommand = new NpgsqlCommand("""
            SELECT s.id, s.student_code, s.full_name, s.guardian_name, s.guardian_phone, s.status,
                   ce.status, ce.starts_on
            FROM circle_enrollments ce
            JOIN students s ON s.id = ce.student_id AND s.is_trashed = FALSE
            WHERE ce.circle_id = @id AND ce.is_trashed = FALSE
            ORDER BY s.full_name;
            """, connection))
        {
            rosterCommand.Parameters.AddWithValue("id", id);
            await using var reader = await rosterCommand.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                roster.Add(new
                {
                    id = reader.GetGuid(0),
                    studentCode = reader.GetString(1),
                    fullName = reader.GetString(2),
                    guardianName = reader.IsDBNull(3) ? null : reader.GetString(3),
                    guardianPhone = reader.IsDBNull(4) ? null : reader.GetString(4),
                    studentStatus = reader.GetString(5),
                    enrollmentStatus = reader.GetString(6),
                    enrolledOn = reader.GetFieldValue<DateOnly>(7)
                });
            }
        }

        var schedule = new List<object>();
        await using (var scheduleCommand = new NpgsqlCommand("""
            SELECT day_of_week, starts_at, duration_minutes
            FROM circle_schedule_slots
            WHERE circle_id = @id AND is_active = TRUE AND is_trashed = FALSE
            ORDER BY day_of_week, starts_at;
            """, connection))
        {
            scheduleCommand.Parameters.AddWithValue("id", id);
            await using var reader = await scheduleCommand.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                schedule.Add(new
                {
                    dayOfWeek = reader.GetInt16(0),
                    startsAt = reader.GetFieldValue<TimeOnly>(1).ToString("HH:mm"),
                    durationMinutes = reader.GetInt32(2)
                });
            }
        }

        var sessions = new List<object>();
        await using (var sessionsCommand = new NpgsqlCommand("""
            SELECT ta.session_date, ta.status, COALESCE(ss.starts_at, '00:00'::time), ta.duration_minutes, ta.note,
                   (SELECT COUNT(*) FROM student_attendance sa
                     WHERE sa.schedule_slot_id = ta.schedule_slot_id AND sa.session_date = ta.session_date
                       AND sa.is_trashed = FALSE AND sa.status = 'present') AS present_students,
                   (SELECT COUNT(*) FROM student_attendance sa
                     WHERE sa.schedule_slot_id = ta.schedule_slot_id AND sa.session_date = ta.session_date
                       AND sa.is_trashed = FALSE AND sa.status IN ('absent', 'excused')) AS missing_students
            FROM teacher_attendance ta
            LEFT JOIN circle_schedule_slots ss ON ss.id = ta.schedule_slot_id
            WHERE ta.circle_id = @id AND ta.is_trashed = FALSE
            ORDER BY ta.session_date DESC, ss.starts_at DESC
            LIMIT 30;
            """, connection))
        {
            sessionsCommand.Parameters.AddWithValue("id", id);
            await using var reader = await sessionsCommand.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                sessions.Add(new
                {
                    date = reader.GetFieldValue<DateOnly>(0),
                    status = reader.GetString(1),
                    startsAt = reader.GetFieldValue<TimeOnly>(2).ToString("HH:mm"),
                    durationMinutes = reader.GetInt32(3),
                    note = reader.IsDBNull(4) ? null : reader.GetString(4),
                    presentStudents = (int)reader.GetInt64(5),
                    missingStudents = (int)reader.GetInt64(6)
                });
            }
        }

        return Results.Ok(new
        {
            circle = new
            {
                id = circleId,
                name,
                teacherId,
                teacherName,
                isActive,
                startsOn,
                monthlyFee
            },
            studentCount = roster.Count,
            roster,
            schedule,
            sessions
        });
    }
}
