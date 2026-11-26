using System.Security.Claims;
using Dar.Common.Pagination;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    internal static async Task<IResult> LoadLegacyTeachersAsync(
        ClaimsPrincipal principal, string? search, string? status, int? page, int? pageSize, HttpContext http,
        NpgsqlDataSource db, CancellationToken ct)
    {
        var paging = LegacyPaging(page, pageSize, out var paged);
        var term = (search ?? string.Empty).Trim();
        var statusFilter = (status ?? string.Empty).Trim();
        var query = """
            SELECT t.id,t.teacher_code,t.full_name,t.phone,t.hourly_rate,t.status,t.notes,t.created_at,t.updated_at,
                   COALESCE((SELECT string_agg(c.name,'، ' ORDER BY c.name) FROM circles c WHERE c.teacher_id=t.id AND c.is_trashed=FALSE), '') AS circle_names,
                   (SELECT COUNT(*) FROM circles c WHERE c.teacher_id=t.id AND c.is_trashed=FALSE) AS circle_count,
                   COUNT(*) OVER() AS total
            FROM teachers t WHERE t.is_trashed=FALSE
              AND (@search = '' OR t.full_name ILIKE @like OR t.teacher_code ILIKE @like OR COALESCE(t.phone,'') ILIKE @like)
              AND (@status = '' OR t.status = @status)
            ORDER BY CASE t.status WHEN 'active' THEN 0 WHEN 'inactive' THEN 1 ELSE 2 END,t.full_name,t.id
            """;
        if (paged) query += " LIMIT @take OFFSET @skip";
        await using var command = db.CreateCommand(query);
        command.Parameters.AddWithValue("search", term);
        command.Parameters.AddWithValue("like", $"%{term}%");
        command.Parameters.AddWithValue("status", statusFilter);
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
            rows.Add(ReadTeacher(reader, CanReadFinance(principal)));
        }
        await reader.DisposeAsync();
        total = await LegacyTotalAsync(command, total, paged, ct);
        LegacyHeaders(http, total, paging, rows.Count, paged);
        return Results.Ok(rows);
    }
}
