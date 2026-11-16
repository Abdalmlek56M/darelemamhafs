using System.Security.Claims;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Teacher;

public static class MoneyEndpoints
{
    public static async Task<IResult> Earnings(
        string? month,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var teacherId = TeachingPrincipal.TeacherId(principal);
        if (teacherId == Guid.Empty)
            return Results.Json(new { message = "هذا الحساب غير مرتبط بمعلمة. راجع المدير." }, statusCode: StatusCodes.Status403Forbidden);
        if (!TryMonth(month, out var from, out var to))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });

        var sessions = new List<object>();
        var totalMinutes = 0;
        var totalAmount = 0m;
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT ta.id, ta.session_date, c.name, ta.duration_minutes, ta.actual_duration_minutes,
                   ta.hourly_rate_snapshot, ta.payable_amount, ta.pay_basis,
                   ta.overtime_minutes, ta.undertime_minutes, ta.note, ta.teacher_session_id, ts.status
            FROM teacher_attendance ta
            JOIN circles c ON c.id = ta.circle_id
            LEFT JOIN teacher_sessions ts ON ts.id = ta.teacher_session_id
            WHERE ta.teacher_id=@teacher AND ta.session_date>=@from AND ta.session_date<@to AND ta.is_trashed=FALSE
            ORDER BY ta.session_date DESC, ta.marked_at DESC;
            """, connection);
        command.Parameters.AddWithValue("teacher", teacherId);
        command.Parameters.AddWithValue("from", from);
        command.Parameters.AddWithValue("to", to);
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                var minutes = reader.GetInt32(3);
                var amount = reader.GetDecimal(6);
                totalMinutes += minutes;
                totalAmount += amount;
                sessions.Add(new
                {
                    attendanceId = reader.GetGuid(0),
                    date = reader.GetFieldValue<DateOnly>(1),
                    circleName = reader.GetString(2),
                    payableMinutes = minutes,
                    actualMinutes = reader.IsDBNull(4) ? (int?)null : reader.GetInt32(4),
                    hourlyRate = reader.GetDecimal(5),
                    payableAmount = amount,
                    payBasis = reader.IsDBNull(7) ? null : reader.GetString(7),
                    overtimeMinutes = reader.GetInt32(8),
                    undertimeMinutes = reader.GetInt32(9),
                    note = reader.IsDBNull(10) ? null : reader.GetString(10),
                    sessionId = reader.IsDBNull(11) ? (Guid?)null : reader.GetGuid(11),
                    sessionStatus = reader.IsDBNull(12) ? null : reader.GetString(12)
                });
            }
        }

        return Results.Ok(new
        {
            month = from.ToString("yyyy-MM"),
            from,
            to,
            totals = new { sessions = sessions.Count, minutes = totalMinutes, payable = totalAmount },
            sessions
        });
    }

    public static async Task<IResult> Subscriptions(
        string? month,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var teacherId = TeachingPrincipal.TeacherId(principal);
        if (teacherId == Guid.Empty)
            return Results.Json(new { message = "هذا الحساب غير مرتبط بمعلمة. راجع المدير." }, statusCode: StatusCodes.Status403Forbidden);
        if (!TryMonth(month, out var from, out _))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });

        var students = new List<object>();
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT s.full_name, s.student_code, c.name, ce.starts_on, s.joined_on,
                   mc.amount_due, COALESCE(p.paid, 0) AS paid,
                   CASE
                     WHEN mc.id IS NULL THEN 'not-set'
                     WHEN COALESCE(p.paid, 0) >= mc.amount_due THEN 'paid'
                     WHEN COALESCE(p.paid, 0) > 0 THEN 'partial'
                     ELSE 'unpaid'
                   END AS status
            FROM circle_enrollments ce
            JOIN students s ON s.id=ce.student_id AND s.is_trashed=FALSE
            JOIN circles c ON c.id=ce.circle_id AND c.is_trashed=FALSE
            LEFT JOIN monthly_charges mc ON mc.enrollment_id=ce.id AND mc.billing_month=@month AND mc.is_trashed=FALSE
            LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(amount),0) AS paid
                FROM payments
                WHERE monthly_charge_id=mc.id AND is_trashed=FALSE
            ) p ON TRUE
            WHERE c.teacher_id=@teacher AND ce.is_trashed=FALSE AND ce.status='active'
            ORDER BY s.full_name;
            """, connection);
        command.Parameters.AddWithValue("teacher", teacherId);
        command.Parameters.AddWithValue("month", from);
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                var due = reader.IsDBNull(5) ? (decimal?)null : reader.GetDecimal(5);
                var paid = reader.GetDecimal(6);
                students.Add(new
                {
                    studentName = reader.GetString(0),
                    studentCode = reader.GetString(1),
                    circleName = reader.GetString(2),
                    startsOn = reader.GetFieldValue<DateOnly>(3),
                    joinedOn = reader.GetFieldValue<DateOnly>(4),
                    amountDue = due,
                    paidAmount = paid,
                    balance = due is null ? (decimal?)null : Math.Max(0, due.Value - paid),
                    status = reader.GetString(7)
                });
            }
        }

        return Results.Ok(new { month = from.ToString("yyyy-MM"), students });
    }

    private static bool TryMonth(string? value, out DateOnly from, out DateOnly to)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            var today = CairoTime.Today();
            from = new DateOnly(today.Year, today.Month, 1);
        }
        else if (!DateOnly.TryParseExact($"{value}-01", "yyyy-MM-dd", out from))
        {
            to = default;
            return false;
        }

        to = from.AddMonths(1);
        return true;
    }
}
