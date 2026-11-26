using Npgsql;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    internal static void MapCollectionsSummary(WebApplication app)
    {
        app.MapGet("/api/summary/collections", async Task<IResult> (string? month, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!TryMonth(month, out var billingMonth))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
            var (rows, _) = await LoadCollections(db, billingMonth, ct);
            return Results.Ok(new
            {
                billingMonth = billingMonth.ToString("yyyy-MM"),
                rowCount = rows.Length,
                totalDue = rows.Sum(row => row.AmountDue),
                totalPaid = rows.Sum(row => row.PaidAmount),
                totalBalance = rows.Sum(row => row.Balance)
            });
        }).RequireAuthorization("finance.read");
    }
}
