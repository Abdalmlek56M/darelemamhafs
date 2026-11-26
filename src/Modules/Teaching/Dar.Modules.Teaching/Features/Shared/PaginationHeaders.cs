using Dar.Common.Pagination;

namespace Dar.Modules.Teaching.Features.Shared;

public static class PaginationHeaders
{
    public static void Apply(HttpResponse response, long total, PageRequest page, int returned)
    {
        response.Headers["X-Total-Count"] = total.ToString();
        response.Headers["X-Page"] = page.Page.ToString();
        response.Headers["X-Page-Size"] = page.PageSize.ToString();
        response.Headers["X-Truncated"] = (returned < total).ToString().ToLowerInvariant();
    }
}
