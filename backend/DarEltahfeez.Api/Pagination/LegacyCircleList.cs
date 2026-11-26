using System.Security.Claims;
using Dar.Common.Pagination;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    internal static async Task<IResult> LoadLegacyCirclesAsync(
        ClaimsPrincipal principal, int? page, int? pageSize, HttpContext http,
        NpgsqlDataSource db, CancellationToken ct)
    {
        var paging = LegacyPaging(page, pageSize, out var paged);
        var query = """
            SELECT c.id,c.circle_code,c.name,c.teacher_id,COALESCE(t.full_name,''),c.monthly_fee,c.schedule_text,c.is_active,c.created_at,c.updated_at,
                 (SELECT COUNT(*) FROM circle_enrollments ce WHERE ce.circle_id=c.id AND ce.status='active' AND ce.is_trashed=FALSE),c.starts_on,
                 COUNT(*) OVER() AS total
            FROM circles c LEFT JOIN teachers t ON t.id=c.teacher_id WHERE c.is_trashed=FALSE
            ORDER BY c.is_active DESC,c.starts_on,c.name,c.id
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
            total = reader.ReadTotal();
            rows.Add(ReadCircle(reader, CanReadFinance(principal)));
        }
        await reader.DisposeAsync();
        total = await LegacyTotalAsync(command, total, paged, ct);
        LegacyHeaders(http, total, paging, rows.Count, paged);
        return Results.Ok(rows);
    }
}
