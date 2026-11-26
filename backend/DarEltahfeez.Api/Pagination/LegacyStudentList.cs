using System.Security.Claims;
using Dar.Common.Pagination;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    internal static async Task<IResult> LoadLegacyStudentListAsync(
        ClaimsPrincipal principal, int? page, int? pageSize, HttpContext http,
        NpgsqlDataSource db, CancellationToken ct)
    {
        var paging = LegacyPaging(page, pageSize, out var paged);
        var finance = CanReadFinance(principal);
        var sql = StudentProjectionWithTotal
            + " WHERE s.is_trashed=FALSE ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1"
            + " WHEN 'withdrawn' THEN 2 ELSE 3 END, s.full_name, s.id";
        if (paged) sql += " LIMIT @take OFFSET @skip";
        await using var cmd = db.CreateCommand(sql);
        if (paged)
        {
            cmd.Parameters.AddWithValue("take", paging.PageSize);
            cmd.Parameters.AddWithValue("skip", paging.Offset);
        }
        var rows = new List<object>();
        long total = 0;
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            total = reader.ReadTotal();
            rows.Add(ReadStudent(reader, finance));
        }
        await reader.DisposeAsync();
        total = await LegacyTotalAsync(cmd, total, paged, ct);
        LegacyHeaders(http, total, paging, rows.Count, paged);
        return Results.Ok(rows);
    }
}
