using System.Security.Claims;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Supervisor;

public static class TeacherNotesFeedEndpoint
{
    public static async Task<IResult> Handle(
        string? kind,
        Guid? teacherId,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var filterKind = string.IsNullOrWhiteSpace(kind) ? "all" : kind.Trim().ToLowerInvariant();
        if (filterKind is not ("all" or "session" or "student"))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["kind"] = ["استخدم all أو session أو student."] });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);

        var rows = new List<object>();
        await using var command = new NpgsqlCommand("""
            SELECT 'session' AS kind, ta.teacher_id, t.full_name, c.name, ta.session_date,
                   ta.note, ta.marked_at, NULL::text AS student_name, NULL::text AS student_code
            FROM teacher_attendance ta
            JOIN teachers t ON t.id = ta.teacher_id AND t.is_trashed = FALSE
            JOIN circles c ON c.id = ta.circle_id AND c.is_trashed = FALSE
            WHERE ta.is_trashed = FALSE
              AND ta.note IS NOT NULL AND btrim(ta.note) <> ''
              AND (@all OR c.id = ANY(@circles))
              AND (@teacher::uuid IS NULL OR t.id = @teacher)
              AND (@kind = 'all' OR @kind = 'session')

            UNION ALL

            SELECT 'student', c.teacher_id, t.full_name, c.name, sa.session_date,
                   sa.note, sa.marked_at, s.full_name, s.student_code
            FROM student_attendance sa
            JOIN circle_enrollments ce ON ce.id = sa.enrollment_id AND ce.is_trashed = FALSE
            JOIN students s ON s.id = ce.student_id AND s.is_trashed = FALSE
            JOIN circles c ON c.id = ce.circle_id AND c.is_trashed = FALSE
            JOIN teachers t ON t.id = c.teacher_id AND t.is_trashed = FALSE
            WHERE sa.is_trashed = FALSE
              AND sa.note IS NOT NULL AND btrim(sa.note) <> ''
              AND (@all OR c.id = ANY(@circles))
              AND (@teacher::uuid IS NULL OR t.id = @teacher)
              AND (@kind = 'all' OR @kind = 'student')

            ORDER BY session_date DESC, marked_at DESC
            LIMIT 120;
            """, connection);
        command.Parameters.AddWithValue("all", scope.All);
        command.Parameters.AddWithValue("circles", scope.CircleIds);
        command.Parameters.AddWithValue("teacher", (object?)teacherId ?? DBNull.Value);
        command.Parameters.AddWithValue("kind", filterKind);

        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                var rowKind = reader.GetString(0);
                rows.Add(new
                {
                    kind = rowKind,
                    teacherId = reader.GetGuid(1),
                    teacherName = reader.GetString(2),
                    circleName = reader.GetString(3),
                    date = reader.GetFieldValue<DateOnly>(4),
                    note = reader.GetString(5),
                    markedAt = reader.GetFieldValue<DateTimeOffset>(6),
                    studentName = reader.IsDBNull(7) ? null : reader.GetString(7),
                    studentCode = reader.IsDBNull(8) ? null : reader.GetString(8)
                });
            }
        }

        string? banner = null;
        await using (var bannerCommand = new NpgsqlCommand("""
            SELECT teacher_notes_banner FROM school_settings
            WHERE id = 1 AND teacher_notes_banner_active = TRUE;
            """, connection))
        {
            if (await bannerCommand.ExecuteScalarAsync(ct) is string text && !string.IsNullOrWhiteSpace(text))
                banner = text.Trim();
        }

        return Results.Ok(new { count = rows.Count, notes = rows, banner });
    }
}
