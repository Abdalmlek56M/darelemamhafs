using Npgsql;

namespace DarEltahfeez.Api;

public static class PayrollLockService
{
    public static async Task<bool> IsLockedAsync(NpgsqlDataSource db, DateOnly sessionDate, CancellationToken ct)
    {
        await using var command = db.CreateCommand("""
            SELECT is_locked FROM payroll_locks
            WHERE billing_month=date_trunc('month',@date::date)::date;
            """);
        command.Parameters.AddWithValue("date", sessionDate);
        var value = await command.ExecuteScalarAsync(ct);
        return value is bool locked && locked;
    }
}
