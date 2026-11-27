using System.Security.Claims;
using Npgsql;

namespace DarEltahfeez.Api;

/// <summary>
/// FINAL 0.3: one server-authoritative money calculation. The dashboard profit, per-circle
/// profit and per-teacher pay totals are computed from the ledger here; the frontend renders
/// the numbers instead of reproducing the formula with floating point.
/// </summary>
public static partial class DomainEndpoints
{
    internal static void MapProfitSummary(WebApplication app)
    {
        app.MapGet("/api/summary/profit", async Task<IResult> (string? month, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!TryMonth(month, out var monthStart))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });

            var (collections, _) = await LoadCollections(db, monthStart, ct, null);
            var circleRows = new Dictionary<Guid, CircleProfitAccumulator>();
            CircleProfitAccumulator Ensure(Guid id, string name) =>
                circleRows.TryGetValue(id, out var row) ? row : circleRows[id] = new CircleProfitAccumulator(id, name);

            decimal billed = 0m, collected = 0m, uncharged = 0m;
            foreach (var row in collections)
            {
                var circle = Ensure(row.CircleId, row.CircleName);
                billed += row.AmountDue;
                collected += row.PaidAmount;
                circle.Billed += row.AmountDue;
                circle.Collected += row.PaidAmount;
                if (row.ChargeId is null) { uncharged++; circle.Uncharged++; }
            }

            var monthEnd = monthStart.AddMonths(1);
            decimal advertising = 0m;
            await using (var cmd = db.CreateCommand("""
                SELECT a.circle_id, c.name, SUM(a.daily_cost * period_calc.overlap_days)
                FROM advertising_expenses a JOIN circles c ON c.id=a.circle_id
                CROSS JOIN LATERAL (
                    SELECT GREATEST(0, LEAST(a.start_date + (a.days_count - 1), @to - 1) - GREATEST(a.start_date, @from) + 1) AS overlap_days
                ) period_calc
                WHERE a.start_date<@to AND (a.start_date + a.days_count - 1)>=@from
                  AND a.is_trashed=FALSE AND c.is_trashed=FALSE
                GROUP BY a.circle_id, c.name;
                """))
            {
                cmd.Parameters.AddWithValue("from", monthStart);
                cmd.Parameters.AddWithValue("to", monthEnd);
                await using var reader = await cmd.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    var amount = reader.GetDecimal(2);
                    advertising += amount;
                    Ensure(reader.GetGuid(0), reader.GetString(1)).Advertising += amount;
                }
            }

            decimal otherExpenses = 0m;
            await using (var cmd = db.CreateCommand("""
                SELECT o.circle_id, c.name, SUM(o.amount) FROM operating_expenses o
                LEFT JOIN circles c ON c.id=o.circle_id
                WHERE o.expense_date>=@from AND o.expense_date<@to AND o.is_trashed=FALSE
                GROUP BY o.circle_id, c.name;
                """))
            {
                cmd.Parameters.AddWithValue("from", monthStart);
                cmd.Parameters.AddWithValue("to", monthEnd);
                await using var reader = await cmd.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    var amount = reader.GetDecimal(2);
                    otherExpenses += amount;
                    if (!reader.IsDBNull(0))
                        Ensure(reader.GetGuid(0), reader.IsDBNull(1) ? "حلقة" : reader.GetString(1)).LinkedExpenses += amount;
                }
            }

            decimal teacherPay = 0m;
            var teacherRows = new Dictionary<Guid, TeacherPayAccumulator>();
            // FINAL Z2: the "past session without attendance" warning is calculated by the
            // server too; the frontend no longer rebuilds any profit formula locally.
            var unmarkedPastSessions = 0;
            await using (var unmarkedCommand = db.CreateCommand("""
                SELECT COUNT(*)
                FROM circle_schedule_slots ss
                JOIN circles c ON c.id = ss.circle_id AND c.is_trashed = FALSE AND c.is_active = TRUE
                CROSS JOIN LATERAL generate_series(@from::date, LEAST(@to::date - 1, (now() AT TIME ZONE 'Africa/Cairo')::date), interval '1 day') AS day
                WHERE ss.is_trashed = FALSE AND ss.is_active = TRUE
                  AND EXTRACT(DOW FROM day)::int = ss.day_of_week
                  AND (day::timestamp + ss.starts_at) AT TIME ZONE 'Africa/Cairo' <= now()
                  AND NOT EXISTS (
                      SELECT 1 FROM teacher_attendance ta
                      WHERE ta.schedule_slot_id = ss.id AND ta.session_date = day::date AND ta.is_trashed = FALSE
                  );
                """))
            {
                unmarkedCommand.Parameters.AddWithValue("from", monthStart);
                unmarkedCommand.Parameters.AddWithValue("to", monthEnd);
                unmarkedPastSessions = Convert.ToInt32(await unmarkedCommand.ExecuteScalarAsync(ct) ?? 0, System.Globalization.CultureInfo.InvariantCulture);
            }
            await using (var cmd = db.CreateCommand("""
                SELECT ta.teacher_id, t.full_name,
                       COUNT(*) FILTER (WHERE ta.status='present') AS sessions,
                       COALESCE(SUM(ta.duration_minutes) FILTER (WHERE ta.status='present'), 0) AS minutes,
                       COALESCE(SUM(ta.payable_amount) FILTER (WHERE ta.status='present'), 0) AS payable
                FROM teacher_attendance ta
                JOIN teachers t ON t.id=ta.teacher_id
                JOIN circles c ON c.id=ta.circle_id
                WHERE ta.session_date>=@from AND ta.session_date<@to AND ta.is_trashed=FALSE AND c.is_trashed=FALSE
                GROUP BY ta.teacher_id, t.full_name;
                """))
            {
                cmd.Parameters.AddWithValue("from", monthStart);
                cmd.Parameters.AddWithValue("to", monthEnd);
                await using var reader = await cmd.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    var payable = reader.GetDecimal(4);
                    teacherPay += payable;
                    var teacherId = reader.GetGuid(0);
                    teacherRows[teacherId] = new TeacherPayAccumulator(
                        teacherId, reader.GetString(1), (int)reader.GetInt64(2), reader.GetDecimal(3), payable);
                }
            }
            foreach (var (circleId, attendance) in await LoadTeacherPayByCircleAsync(db, monthStart, monthEnd, ct))
                Ensure(circleId, "حلقة").TeacherPay += attendance;

            var circles = circleRows.Values
                .Select(row => new
                {
                    circleId = row.CircleId,
                    circleName = row.CircleName,
                    billed = MoneyRules.RoundCurrency(row.Billed),
                    collected = MoneyRules.RoundCurrency(row.Collected),
                    advertising = MoneyRules.RoundCurrency(row.Advertising),
                    teacherPay = MoneyRules.RoundCurrency(row.TeacherPay),
                    linkedExpenses = MoneyRules.RoundCurrency(row.LinkedExpenses),
                    uncharged = row.Uncharged,
                    net = MoneyRules.RoundCurrency(row.Billed - row.Advertising - row.TeacherPay - row.LinkedExpenses)
                })
                .OrderByDescending(row => row.net)
                .ThenBy(row => row.circleName, StringComparer.Ordinal)
                .ToArray();

            var result = new
            {
                month = monthStart.ToString("yyyy-MM", System.Globalization.CultureInfo.InvariantCulture),
                dashboard = new
                {
                    billed = MoneyRules.RoundCurrency(billed),
                    collected = MoneyRules.RoundCurrency(collected),
                    balance = MoneyRules.RoundCurrency(billed - collected),
                    advertising = MoneyRules.RoundCurrency(advertising),
                    teacherPay = MoneyRules.RoundCurrency(teacherPay),
                    otherExpenses = MoneyRules.RoundCurrency(otherExpenses),
                    net = MoneyRules.RoundCurrency(billed - advertising - teacherPay - otherExpenses),
                    withoutChargeCount = (int)uncharged,
                    unmarkedPastSessions
                },
                teachers = teacherRows.Values.Select(row => new
                {
                    teacherId = row.TeacherId,
                    teacherName = row.TeacherName,
                    sessions = row.Sessions,
                    hours = Math.Round(row.Minutes / 60m, 2),
                    payable = MoneyRules.RoundCurrency(row.Payable),
                    avgHourlyRate = row.Minutes == 0 ? 0m : Math.Round(row.Payable / (row.Minutes / 60m), 2)
                }).OrderByDescending(row => row.payable).ToArray(),
                circles
            };
            return Results.Ok(result);
        }).RequireAuthorization("finance.read");
    }

    private static async Task<List<(Guid CircleId, decimal Payable)>> LoadTeacherPayByCircleAsync(
        NpgsqlDataSource db, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var rows = new List<(Guid, decimal)>();
        await using var cmd = db.CreateCommand("""
            SELECT ta.circle_id, COALESCE(SUM(ta.payable_amount) FILTER (WHERE ta.status='present'), 0)
            FROM teacher_attendance ta JOIN circles c ON c.id=ta.circle_id
            WHERE ta.session_date>=@from AND ta.session_date<@to AND ta.is_trashed=FALSE AND c.is_trashed=FALSE
            GROUP BY ta.circle_id;
            """);
        cmd.Parameters.AddWithValue("from", from);
        cmd.Parameters.AddWithValue("to", to);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) rows.Add((reader.GetGuid(0), reader.GetDecimal(1)));
        return rows;
    }

    private sealed class CircleProfitAccumulator(Guid circleId, string circleName)
    {
        internal Guid CircleId { get; } = circleId;
        internal string CircleName { get; } = circleName;
        internal decimal Billed { get; set; }
        internal decimal Collected { get; set; }
        internal decimal Advertising { get; set; }
        internal decimal TeacherPay { get; set; }
        internal decimal LinkedExpenses { get; set; }
        internal int Uncharged { get; set; }
    }

    private sealed record TeacherPayAccumulator(
        Guid TeacherId, string TeacherName, int Sessions, decimal Minutes, decimal Payable);
}
