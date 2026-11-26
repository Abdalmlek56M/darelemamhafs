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
        var paging = new PageRequest(page, pageSize);
        var paged = page is not null || pageSize is not null;
        var finance = CanReadFinance(principal);
        var sql = StudentProjection.Replace(
            "FROM students s", ", COUNT(*) OVER() AS total FROM students s")
            + " WHERE s.is_trashed=FALSE ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1"
            + " WHEN 'withdrawn' THEN 2 ELSE 3 END, s.full_name";
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
            total = reader.GetInt64(16);
            rows.Add(ReadStudent(reader, finance));
        }
        await reader.DisposeAsync();
        if (paged && total == 0)
        {
            cmd.Parameters["skip"].Value = 0L;
            cmd.Parameters["take"].Value = 1;
            await using var fallback = await cmd.ExecuteReaderAsync(ct);
            if (await fallback.ReadAsync(ct)) total = fallback.GetInt64(16);
        }
        http.Response.Headers["X-Total-Count"] = total.ToString();
        http.Response.Headers["X-Page"] = paging.Page.ToString();
        http.Response.Headers["X-Page-Size"] = paging.PageSize.ToString();
        http.Response.Headers["X-Truncated"] = PaginationRules.IsTruncated(total, paging, rows.Count, paged).ToString().ToLowerInvariant();
        return Results.Ok(rows);
    }
}
