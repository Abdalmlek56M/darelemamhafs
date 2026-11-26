using Npgsql;

namespace Dar.Common.Pagination;

/// <summary>Normalized page request shared by every list endpoint.</summary>
public readonly record struct PageRequest
{
    public const int DefaultPageSize = 25;
    public const int MaxPageSize = 100;

    public int Page { get; }
    public int PageSize { get; }
    public long Offset => ((long)Page - 1) * PageSize;

    public PageRequest(int? page = null, int? pageSize = null)
    {
        Page = page is > 0 ? page.Value : 1;
        var requested = pageSize ?? DefaultPageSize;
        PageSize = requested <= 0 ? DefaultPageSize : Math.Min(requested, MaxPageSize);
    }
}

/// <summary>Uniform page envelope returned when pagination is requested.</summary>
public static class PaginationRules
{
    public static bool IsTruncated(long total, PageRequest page, int returned, bool paged) =>
        paged ? (long)page.Page * page.PageSize < total : returned < total;

    public static async Task<long> EnsureTotalAsync(
        NpgsqlCommand command, long total, int totalOrdinal, bool paged, CancellationToken ct)
    {
        if (total > 0 || !paged) return total;
        if (command.Parameters.TryGetValue("skip", out var skip)) skip.Value = 0L;
        if (command.Parameters.TryGetValue("take", out var take)) take.Value = 1;
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? reader.GetInt64(totalOrdinal) : 0;
    }
}

public sealed record PageResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int Total)
{
    public int TotalPages => Total <= 0 ? 0 : (int)Math.Ceiling(Total / (double)PageSize);
    public bool HasPreviousPage => Page > 1;
    public bool HasNextPage => Page < TotalPages;
}
