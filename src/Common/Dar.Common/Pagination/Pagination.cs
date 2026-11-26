namespace Dar.Common.Pagination;

/// <summary>Normalized page request shared by every list endpoint.</summary>
public readonly record struct PageRequest
{
    public const int DefaultPageSize = 25;
    public const int MaxPageSize = 100;

    public int Page { get; }
    public int PageSize { get; }
    public int Offset => (Page - 1) * PageSize;

    public PageRequest(int? page = null, int? pageSize = null)
    {
        Page = page is > 0 ? page.Value : 1;
        var requested = pageSize ?? DefaultPageSize;
        PageSize = requested <= 0 ? DefaultPageSize : Math.Min(requested, MaxPageSize);
    }
}

/// <summary>Uniform page envelope returned when pagination is requested.</summary>
public sealed record PageResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int Total)
{
    public int TotalPages => Total <= 0 ? 0 : (int)Math.Ceiling(Total / (double)PageSize);
    public bool HasPreviousPage => Page > 1;
    public bool HasNextPage => Page < TotalPages;
}
