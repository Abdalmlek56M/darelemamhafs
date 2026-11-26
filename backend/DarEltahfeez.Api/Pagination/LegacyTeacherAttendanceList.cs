using System.Security.Claims;
using Dar.Common.Pagination;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    internal static async Task<IResult> LoadLegacyTeacherAttendanceListAsync(
        string? month, ClaimsPrincipal principal, int? page, int? pageSize, HttpContext http,
        NpgsqlDataSource db, CancellationToken ct)
    {
        var financeVisible = CanReadFinance(principal);
        if (!TryMonth(month, out var from))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
        var to = from.AddMonths(1);
        var paging = LegacyPaging(page, pageSize, out var paged);
        var query = """
            SELECT a.id,a.schedule_slot_id,a.circle_id,c.name,a.teacher_id,t.full_name,a.session_date,a.scheduled_start,
                   a.duration_minutes,a.status,a.hourly_rate_snapshot,a.payable_amount,a.note,a.marked_at,
                   COUNT(*) OVER() AS total
            FROM teacher_attendance a JOIN circles c ON c.id=a.circle_id JOIN teachers t ON t.id=a.teacher_id
            WHERE a.session_date>=@from AND a.session_date<@to AND a.is_trashed=FALSE AND c.is_trashed=FALSE
            ORDER BY a.session_date DESC,a.scheduled_start DESC,t.full_name,a.id
            """;
        if (paged) query += " LIMIT @take OFFSET @skip";
        await using var command = db.CreateCommand(query);
        command.Parameters.AddWithValue("from", from);
        command.Parameters.AddWithValue("to", to);
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
                scheduleSlotId = reader.IsDBNull(1) ? (Guid?)null : reader.GetGuid(1),
                circleId = reader.GetGuid(2),
                circleName = reader.GetString(3),
                teacherId = reader.GetGuid(4),
                teacherName = reader.GetString(5),
                sessionDate = reader.GetFieldValue<DateOnly>(6),
                startsAt = reader.GetFieldValue<TimeOnly>(7).ToString("HH:mm"),
                durationMinutes = reader.GetInt32(8),
                status = reader.GetString(9),
                hourlyRateSnapshot = financeVisible ? reader.GetDecimal(10) : (decimal?)null,
                payableAmount = financeVisible ? reader.GetDecimal(11) : (decimal?)null,
                note = reader.IsDBNull(12) ? null : reader.GetString(12),
                markedAt = reader.GetFieldValue<DateTimeOffset>(13)
            });
        }
        await reader.DisposeAsync();
        total = await LegacyTotalAsync(command, total, paged, ct);
        LegacyHeaders(http, total, paging, rows.Count, paged);
        return Results.Ok(rows);
    }
}
