using Npgsql;
using Dar.Common.Pagination;

namespace Dar.Modules.Teaching.Features.Shared;

public static class PaginationHeaders
{
    public static async Task<long> EnsureTotalAsync(
        NpgsqlCommand command, long total, int totalOrdinal, bool paged, CancellationToken ct)
    {
        if (total > 0 || !paged) return total;
        if (command.Parameters.TryGetValue("skip", out var skip)) skip.Value = 0L;
        if (command.Parameters.TryGetValue("take", out var take)) take.Value = 1;
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? reader.GetInt64(totalOrdinal) : 0;
    }

    public static void Apply(HttpResponse response, long total, PageRequest page, int returned, bool paged)
    {
        response.Headers["X-Total-Count"] = total.ToString();
        response.Headers["X-Page"] = page.Page.ToString();
        response.Headers["X-Page-Size"] = page.PageSize.ToString();
        var truncated = PaginationRules.IsTruncated(total, page, returned, paged);
        response.Headers["X-Truncated"] = truncated.ToString().ToLowerInvariant();
    }
}
