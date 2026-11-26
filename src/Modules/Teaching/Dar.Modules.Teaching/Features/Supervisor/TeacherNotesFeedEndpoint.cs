using System.Security.Claims;
using Dar.Common.Pagination;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Supervisor;

public static class TeacherNotesFeedEndpoint
{
    public static async Task<IResult> Handle(
        string? kind,
        Guid? teacherId,
        int? page,
        int? pageSize,
        HttpContext http,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var filterKind = string.IsNullOrWhiteSpace(kind) ? "all" : kind.Trim().ToLowerInvariant();
        if (filterKind is not ("all" or "session" or "student"))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["kind"] = ["استخدم all أو session أو student."] });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);
        var paging = new PageRequest(page, pageSize);
        var paged = page is not null || pageSize is not null;
        var take = paged ? paging.PageSize : 120;

        var rows = new List<object>();
        long total = 0;
        await using (var command = new NpgsqlCommand("""
            SELECT combined.*, COUNT(*) OVER() AS total
            FROM (
                SELECT 'session' AS kind, ta.id, ta.teacher_id, t.full_name, c.name, ta.session_date,
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

                SELECT 'student', sa.id, c.teacher_id, t.full_name, c.name, sa.session_date,
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
            ) combined
            ORDER BY combined.session_date DESC, combined.marked_at DESC, combined.id
            LIMIT @take OFFSET @skip;
            """, connection))
        {
            command.Parameters.AddWithValue("all", scope.All);
            command.Parameters.AddWithValue("circles", scope.CircleIds);
            command.Parameters.AddWithValue("teacher", (object?)teacherId ?? DBNull.Value);
            command.Parameters.AddWithValue("kind", filterKind);
            command.Parameters.AddWithValue("take", take);
            command.Parameters.AddWithValue("skip", paged ? paging.Offset : 0L);

            await using (var reader = await command.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                {
                    total = reader.ReadTotal();
                    var rowKind = reader.GetString(0);
                    rows.Add(new
                    {
                        kind = rowKind,
                        id = reader.GetGuid(1),
                        teacherId = reader.GetGuid(2),
                        teacherName = reader.GetString(3),
                        circleName = reader.GetString(4),
                        date = reader.GetFieldValue<DateOnly>(5),
                        note = reader.GetString(6),
                        markedAt = reader.GetFieldValue<DateTimeOffset>(7),
                        studentName = reader.IsDBNull(8) ? null : reader.GetString(8),
                        studentCode = reader.IsDBNull(9) ? null : reader.GetString(9)
                    });
                }
            }
            total = await PaginationRules.EnsureTotalAsync(command, total, paged, ct);
        }

        PaginationHeaderWriter.Write(http.Response, total, paging, rows.Count, paged);

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
