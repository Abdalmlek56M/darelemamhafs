using Dar.Common.Pagination;

namespace DarEltahfeez.Api.Pagination;

internal static class LegacyPaginationHeaders
{
    internal static void Apply(HttpResponse response, long total, PageRequest page, int returned, bool paged)
    {
        response.Headers["X-Total-Count"] = total.ToString();
        response.Headers["X-Page"] = page.Page.ToString();
        response.Headers["X-Page-Size"] = page.PageSize.ToString();
        var truncated = paged ? (long)page.Page * page.PageSize < total : returned < total;
        response.Headers["X-Truncated"] = truncated.ToString().ToLowerInvariant();
    }
}
