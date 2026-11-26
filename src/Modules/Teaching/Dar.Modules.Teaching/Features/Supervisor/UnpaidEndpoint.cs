using System.Security.Claims;
using Npgsql;
using Dar.Common.Pagination;
using Dar.Common.Domain;

namespace Dar.Modules.Teaching.Features.Supervisor;

public static class UnpaidEndpoint
{
    private sealed record UnpaidRow(
        Guid ChargeId, Guid StudentId, DateOnly BillingMonth, string StudentName, string StudentCode, string? GuardianPhone, DateOnly JoinedOn,
        string CircleName, string TeacherName, decimal AmountDue, decimal Paid, decimal Balance);

    public static async Task<IResult> Handle(
        string? month, int? page, int? pageSize, HttpContext http,
        ClaimsPrincipal principal, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        var hasFinance = TeachingPrincipal.Has(principal, "finance.read");
        if (!TryMonth(month, out var billingMonth))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });

        var today = CairoTime.Today();
        var paging = new PageRequest(page, pageSize);
        var paged = page is not null || pageSize is not null;
        var rows = new List<UnpaidRow>();
        long total = 0;
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);
        await using (var command = new NpgsqlCommand("""
            SELECT mc.id, s.id, mc.billing_month, s.full_name, s.student_code, s.guardian_phone, s.joined_on,
                   c.name, COALESCE(t.full_name, ''), mc.amount_due, COALESCE(p.paid, 0),
                   COUNT(*) OVER() AS total
            FROM monthly_charges mc
            JOIN circle_enrollments ce ON ce.id = mc.enrollment_id AND ce.is_trashed = FALSE
            JOIN students s ON s.id = ce.student_id AND s.is_trashed = FALSE
            JOIN circles c ON c.id = ce.circle_id AND c.is_trashed = FALSE
            LEFT JOIN teachers t ON t.id = c.teacher_id
            LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(amount), 0) AS paid
                FROM payments
                WHERE monthly_charge_id = mc.id AND is_trashed = FALSE AND voided_at IS NULL
            ) p ON TRUE
            WHERE mc.is_trashed = FALSE
              AND mc.voided_at IS NULL
              AND mc.billing_month = @month
              AND mc.amount_due > COALESCE(p.paid, 0)
              AND (@all OR c.id = ANY(@circles))
              AND (@today >= (mc.billing_month + INTERVAL '1 month - 1 day')
                   OR @today >= (s.joined_on + INTERVAL '1 month'))
            ORDER BY s.full_name, mc.id
            LIMIT @take OFFSET @skip;
            """, connection))
        {
            command.Parameters.AddWithValue("month", billingMonth);
            command.Parameters.AddWithValue("today", today);
            command.Parameters.AddWithValue("all", scope.All);
            command.Parameters.AddWithValue("circles", scope.CircleIds);
            command.Parameters.AddWithValue("take", paged ? paging.PageSize : 300);
            command.Parameters.AddWithValue("skip", paged ? paging.Offset : 0L);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                total = reader.ReadTotal();
                rows.Add(new UnpaidRow(
                    reader.GetGuid(0), reader.GetGuid(1), reader.GetFieldValue<DateOnly>(2), reader.GetString(3), reader.GetString(4),
                    reader.IsDBNull(5) ? null : reader.GetString(5),
                    reader.GetFieldValue<DateOnly>(6), reader.GetString(7), reader.GetString(8),
                    reader.GetDecimal(9), reader.GetDecimal(10), Money.Balance(reader.GetDecimal(9), reader.GetDecimal(10))));
            }
            await reader.DisposeAsync();
            total = await PaginationRules.EnsureTotalAsync(command, total, paged, ct);
        }

        PaginationHeaderWriter.Write(http.Response, total, paging, rows.Count, paged);
        return Results.Ok(new
        {
            month = billingMonth.ToString("yyyy-MM"),
            today,
            canViewAmounts = hasFinance,
            count = rows.Count,
            unpaid = rows.Select(row => new
            {
                chargeId = row.ChargeId,
                studentId = row.StudentId,
                billingMonth = row.BillingMonth,
                studentName = row.StudentName,
                studentCode = row.StudentCode,
                guardianPhone = row.GuardianPhone,
                joinedOn = row.JoinedOn,
                circleName = row.CircleName,
                teacherName = row.TeacherName,
                amountDue = hasFinance ? row.AmountDue : (decimal?)null,
                paidAmount = hasFinance ? row.Paid : (decimal?)null,
                balance = hasFinance ? row.Balance : (decimal?)null,
                status = row.Paid > 0 ? "partial" : "unpaid"
            })
        });
    }

    private static bool TryMonth(string? value, out DateOnly month)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            var today = CairoTime.Today();
            month = new DateOnly(today.Year, today.Month, 1);
            return true;
        }
        return DateOnly.TryParseExact($"{value}-01", "yyyy-MM-dd", out month);
    }
}
