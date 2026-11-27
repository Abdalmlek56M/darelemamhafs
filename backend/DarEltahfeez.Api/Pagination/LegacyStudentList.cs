using System.Security.Claims;
using Dar.Common.Pagination;
using Dar.Common.Search;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    internal static async Task<IResult> LoadLegacyStudentListAsync(
        ClaimsPrincipal principal, string? search, string? status, int? page, int? pageSize, HttpContext http,
        NpgsqlDataSource db, CancellationToken ct)
    {
        var paging = LegacyPaging(page, pageSize, out var paged);
        var finance = CanReadFinance(principal);
        var term = (search ?? string.Empty).Trim();
        var statusFilter = (status ?? string.Empty).Trim();
        var sql = StudentProjectionWithTotal
            + " WHERE s.is_trashed=FALSE"
            + " AND (@search = '' OR s.full_name ILIKE @like OR s.student_code ILIKE @like OR COALESCE(s.phone,'') ILIKE @like"
            + " OR COALESCE(s.guardian_name,'') ILIKE @like OR COALESCE(s.guardian_phone,'') ILIKE @like)"
            + " AND (@status = '' OR s.status = @status)"
            + " ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1"
            + " WHEN 'withdrawn' THEN 2 ELSE 3 END, s.full_name, s.id";
        if (paged) sql += " LIMIT @take OFFSET @skip";
        await using var cmd = db.CreateCommand(sql);
        cmd.Parameters.AddWithValue("search", term);
        // FINAL 2.2: the raw term is still needed for the empty-search guard; the LIKE
        // pattern additionally escapes %, _ and \ so those characters match literally.
        cmd.Parameters.AddWithValue("like", SqlSearchPattern.Contains(term));
        cmd.Parameters.AddWithValue("status", statusFilter);
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
