namespace Dar.Common.Domain;

/// <summary>Standard paged response for every list endpoint.</summary>
public sealed record PagedResult<T>(
    IReadOnlyList<T> Items,
    int Page,
    int PageSize,
    long Total)
{
    public static PagedResult<T> Empty(int page = 1, int pageSize = 25) =>
        new([], page, pageSize, 0);
}
