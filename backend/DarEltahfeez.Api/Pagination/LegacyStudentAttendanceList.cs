using Dar.Common.Pagination;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    internal static async Task<IResult> LoadLegacyStudentAttendanceListAsync(
        string? month, int? page, int? pageSize, HttpContext http,
        NpgsqlDataSource db, CancellationToken ct)
    {
        if (!TryMonth(month, out var from))
            return Results.ValidationProblem(
                new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
        var paging = LegacyPaging(page, pageSize, out var paged);
        var query = """
            SELECT sa.id,sa.schedule_slot_id,ce.id,s.id,s.student_code,s.full_name,c.id,c.name,
                   c.teacher_id,COALESCE(t.full_name,''),sa.session_date,ss.starts_at,sa.status,sa.note,sa.marked_at,
                   COUNT(*) OVER() AS total
            FROM student_attendance sa JOIN circle_enrollments ce ON ce.id=sa.enrollment_id
            JOIN students s ON s.id=ce.student_id JOIN circles c ON c.id=ce.circle_id
            JOIN circle_schedule_slots ss ON ss.id=sa.schedule_slot_id LEFT JOIN teachers t ON t.id=c.teacher_id
            WHERE sa.session_date>=@from AND sa.session_date<@to AND sa.is_trashed=FALSE
              AND ce.is_trashed=FALSE AND s.is_trashed=FALSE AND c.is_trashed=FALSE
            ORDER BY sa.session_date DESC,ss.starts_at DESC,c.name,s.full_name,sa.id
            """;
        if (paged) query += " LIMIT @take OFFSET @skip";
        await using var command = db.CreateCommand(query);
        command.Parameters.AddWithValue("from", from);
        command.Parameters.AddWithValue("to", from.AddMonths(1));
        if (paged)
        {
            command.Parameters.AddWithValue("take", paging.PageSize);
            command.Parameters.AddWithValue("skip", paging.Offset);
        }
        var rows = new List<object>();
        long total = 0;
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            total = reader.ReadTotal();
            rows.Add(new
            {
                id = reader.GetGuid(0),
                scheduleSlotId = reader.GetGuid(1),
                enrollmentId = reader.GetGuid(2),
                studentId = reader.GetGuid(3),
                studentCode = reader.GetString(4),
                studentName = reader.GetString(5),
                circleId = reader.GetGuid(6),
                circleName = reader.GetString(7),
                teacherId = reader.IsDBNull(8) ? (Guid?)null : reader.GetGuid(8),
                teacherName = reader.GetString(9),
                sessionDate = reader.GetFieldValue<DateOnly>(10),
                startsAt = reader.GetFieldValue<TimeOnly>(11).ToString("HH:mm"),
                status = reader.GetString(12),
                note = reader.IsDBNull(13) ? null : reader.GetString(13),
                markedAt = reader.GetFieldValue<DateTimeOffset>(14)
            });
        }
        await reader.DisposeAsync();
        total = await LegacyTotalAsync(command, total, paged, ct);
        LegacyHeaders(http, total, paging, rows.Count, paged);
        return Results.Ok(rows);
    }
}
