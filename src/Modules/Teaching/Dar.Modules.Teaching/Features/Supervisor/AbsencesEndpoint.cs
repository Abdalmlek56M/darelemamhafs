using Npgsql;

namespace Dar.Modules.Teaching.Features.Supervisor;

public static class AbsencesEndpoint
{
    public static async Task<IResult> Handle(string? date, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        DateOnly day;
        if (string.IsNullOrWhiteSpace(date))
            day = CairoTime.Today();
        else if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", out day))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["date"] = ["حدد التاريخ بصيغة YYYY-MM-DD."] });

        var rows = new List<object>();
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT sa.id, sa.session_date, s.full_name, s.student_code, c.name, COALESCE(t.full_name, ''),
                   sa.status, sa.note, sa.marked_at
            FROM student_attendance sa
            JOIN circle_enrollments ce ON ce.id = sa.enrollment_id
            JOIN students s ON s.id = ce.student_id AND s.is_trashed = FALSE
            JOIN circles c ON c.id = ce.circle_id AND c.is_trashed = FALSE
            LEFT JOIN teachers t ON t.id = c.teacher_id
            WHERE sa.session_date = @date AND sa.is_trashed = FALSE AND sa.status IN ('absent', 'excused')
            ORDER BY c.name, s.full_name
            LIMIT 300;
            """, connection);
        command.Parameters.AddWithValue("date", day);
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                rows.Add(new
                {
                    attendanceId = reader.GetGuid(0),
                    date = reader.GetFieldValue<DateOnly>(1),
                    studentName = reader.GetString(2),
                    studentCode = reader.GetString(3),
                    circleName = reader.GetString(4),
                    teacherName = reader.GetString(5),
                    status = reader.GetString(6),
                    note = reader.IsDBNull(7) ? null : reader.GetString(7),
                    markedAt = reader.GetFieldValue<DateTimeOffset>(8)
                });
            }
        }

        return Results.Ok(new { date = day, absences = rows });
    }
}
