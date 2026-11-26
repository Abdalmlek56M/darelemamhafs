using Npgsql;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    internal static void MapFinanceEntryOptionsSummary(WebApplication app)
    {
        app.MapGet("/api/summary/finance-entry-options", async Task<IResult> (string? month, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!TryMonth(month, out var billingMonth))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
            await using var cmd = db.CreateCommand("""
                SELECT (SELECT COUNT(*) FROM circle_enrollments ce
                          JOIN students s ON s.id=ce.student_id
                          JOIN circles c ON c.id=ce.circle_id
                          WHERE ce.is_trashed=FALSE AND s.is_trashed=FALSE AND c.is_trashed=FALSE
                            AND ce.starts_on<=(@month+INTERVAL '1 month - 1 day')::date
                            AND (ce.ends_on IS NULL OR ce.ends_on>=@month)
                            AND public.dar_enrollment_has_active_day_in_month(ce.id,@month)
                            AND NOT EXISTS(SELECT 1 FROM monthly_charges existing_charge WHERE existing_charge.enrollment_id=ce.id
                              AND existing_charge.billing_month=@month AND existing_charge.is_trashed=FALSE AND existing_charge.voided_at IS NULL)),
                       (SELECT COUNT(*) FROM monthly_charges mc
                          JOIN circle_enrollments ce ON ce.id=mc.enrollment_id
                          JOIN students s ON s.id=ce.student_id
                          JOIN circles c ON c.id=ce.circle_id
                          WHERE mc.billing_month=@month AND mc.is_trashed=FALSE AND mc.voided_at IS NULL
                            AND ce.is_trashed=FALSE AND s.is_trashed=FALSE AND c.is_trashed=FALSE);
                """);
            cmd.Parameters.AddWithValue("month", billingMonth);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            return Results.Ok(new
            {
                billingMonth = billingMonth.ToString("yyyy-MM"),
                enrollments = reader.GetInt64(0),
                charges = reader.GetInt64(1)
            });
        }).RequireAuthorization("finance.create");
    }
}
