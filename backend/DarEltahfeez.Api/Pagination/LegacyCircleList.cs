using System.Security.Claims;
using Dar.Common.Pagination;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    /// <summary>
    /// Tier 2.7: the per-row correlated active-student COUNT subquery became a LEFT JOIN LATERAL
    /// aggregate. ReadCircle ordinals are unchanged (count at 10, starts_on at 11, total at 12).
    /// </summary>
    private const string LegacyCircleListSql = """
        SELECT c.id,c.circle_code,c.name,c.teacher_id,COALESCE(t.full_name,''),c.monthly_fee,c.schedule_text,c.is_active,c.created_at,c.updated_at,
               active_students.student_count AS active_student_count,c.starts_on,c.circle_type,c.is_children,
               COUNT(*) OVER() AS total
        FROM circles c
        LEFT JOIN teachers t ON t.id=c.teacher_id
        LEFT JOIN LATERAL (
            SELECT COUNT(*) AS student_count
            FROM circle_enrollments ce
            WHERE ce.circle_id=c.id AND ce.status='active' AND ce.is_trashed=FALSE
        ) active_students ON TRUE
        WHERE c.is_trashed=FALSE
          AND (@search = '' OR c.name ILIKE @like OR COALESCE(c.circle_code,'') ILIKE @like OR COALESCE(t.full_name,'') ILIKE @like)
        ORDER BY c.is_active DESC,c.starts_on,c.name,c.id
        """;

    internal static async Task<IResult> LoadLegacyCirclesAsync(
        ClaimsPrincipal principal, string? search, int? page, int? pageSize, HttpContext http,
        NpgsqlDataSource db, CancellationToken ct)
    {
        var paging = LegacyPaging(page, pageSize, out var paged);
        var term = (search ?? string.Empty).Trim();
        var query = LegacyCircleListSql;
        if (paged) query += " LIMIT @take OFFSET @skip";
        await using var command = db.CreateCommand(query);
        command.Parameters.AddWithValue("search", term);
        command.Parameters.AddWithValue("like", $"%{term}%");
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
