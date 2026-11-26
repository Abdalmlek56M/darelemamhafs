using Npgsql;

namespace Dar.Common.Pagination;

/// <summary>Reads the shared <c>COUNT(*) OVER() AS total</c> column by name.</summary>
public static class PaginationReader
{
    private const string TotalColumn = "total";

    public static long ReadTotal(this NpgsqlDataReader reader) =>
        reader.GetInt64(reader.GetOrdinal(TotalColumn));
}
