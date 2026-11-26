using Microsoft.AspNetCore.Http;

namespace Dar.Common.Pagination;

public static class PaginationHeaderWriter
{
    public static void Write(HttpResponse response, long total, PageRequest page, int returned, bool paged)
    {
        response.Headers["X-Total-Count"] = total.ToString();
        response.Headers["X-Page"] = page.Page.ToString();
        response.Headers["X-Page-Size"] = page.PageSize.ToString();
        var truncated = PaginationRules.IsTruncated(total, page, returned, paged);
        response.Headers["X-Truncated"] = truncated.ToString().ToLowerInvariant();
    }
}
