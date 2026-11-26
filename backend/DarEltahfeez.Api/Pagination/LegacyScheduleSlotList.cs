using System.Security.Claims;
using Dar.Common.Pagination;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    internal static async Task<IResult> LoadLegacyScheduleSlotsAsync(
        int? page, int? pageSize, HttpContext http,
        NpgsqlDataSource db, CancellationToken ct)
    {
        var paging = LegacyPaging(page, pageSize, out var paged);
        var query = """
            SELECT ss.id,ss.circle_id,c.name,c.teacher_id,COALESCE(t.full_name,''),ss.day_of_week,ss.starts_at,ss.duration_minutes,ss.is_active,c.is_active,
                   COUNT(*) OVER() AS total
            FROM circle_schedule_slots ss JOIN circles c ON c.id=ss.circle_id
            LEFT JOIN teachers t ON t.id=c.teacher_id
            WHERE ss.is_trashed=FALSE AND c.is_trashed=FALSE
              AND (ss.is_active=TRUE OR EXISTS(SELECT 1 FROM teacher_attendance ta WHERE ta.schedule_slot_id=ss.id AND ta.is_trashed=FALSE)
                OR EXISTS(SELECT 1 FROM student_attendance sa WHERE sa.schedule_slot_id=ss.id AND sa.is_trashed=FALSE))
            ORDER BY ss.is_active DESC,ss.day_of_week,ss.starts_at,c.name
            """;
        if (paged) query += " LIMIT @take OFFSET @skip";
        await using var command = db.CreateCommand(query);
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
            total = reader.GetInt64(10);
            rows.Add(new { id = reader.GetGuid(0), circleId = reader.GetGuid(1), circleName = reader.GetString(2), teacherId = reader.IsDBNull(3) ? (Guid?)null : reader.GetGuid(3), teacherName = reader.GetString(4), dayOfWeek = reader.GetInt16(5), startsAt = reader.GetFieldValue<TimeOnly>(6).ToString("HH:mm"), durationMinutes = reader.GetInt32(7), isActive = reader.GetBoolean(8), circleIsActive = reader.GetBoolean(9) });
        }
        await reader.DisposeAsync();
        total = await LegacyTotalAsync(command, total, 10, paged, ct);
        LegacyHeaders(http, total, paging, rows.Count, paged);
        return Results.Ok(rows);
    }
}
