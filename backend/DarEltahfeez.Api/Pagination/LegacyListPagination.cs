using Dar.Common.Pagination;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private static PageRequest LegacyPaging(int? page, int? pageSize, out bool paged)
    {
        paged = page is not null || pageSize is not null;
        return new PageRequest(page, pageSize);
    }

    private static void LegacyHeaders(HttpContext http, long total, PageRequest paging, int returned, bool paged) =>
        PaginationHeaderWriter.Write(http.Response, total, paging, returned, paged);

    private static async Task<long> LegacyTotalAsync(
        NpgsqlCommand command, long total, int ordinal, bool paged, CancellationToken ct) =>
        await PaginationRules.EnsureTotalAsync(command, total, ordinal, paged, ct);
}
