using Npgsql;

namespace DarEltahfeez.Api;

/// <summary>
/// FINAL 0.1: replay detection for money writes. A client sends an Idempotency-Key header;
/// a replay returns the row created by the first request instead of inserting a duplicate.
/// The UNIQUE partial indexes live in migration 033.
/// </summary>
internal static class IdempotencySupport
{
    internal const string HeaderName = "Idempotency-Key";
    internal const int MaxKeyLength = 128;

    internal static string? ReadKey(HttpRequest request)
    {
        if (!request.Headers.TryGetValue(HeaderName, out var values)) return null;
        var raw = values.ToString().Trim();
        if (raw.Length == 0) return null;
        return raw.Length <= MaxKeyLength ? raw : null;
    }

    internal static async Task<PaymentReplay?> FindPaymentAsync(
        NpgsqlConnection connection, NpgsqlTransaction? transaction, string key, CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("""
            SELECT id, monthly_charge_id, amount, paid_at, method, reference, note
            FROM payments WHERE client_key=@key AND is_trashed=FALSE;
            """, connection, transaction);
        command.Parameters.AddWithValue("key", key);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        return new PaymentReplay(
            reader.GetGuid(0),
            reader.GetGuid(1),
            reader.GetDecimal(2),
            reader.GetFieldValue<DateTimeOffset>(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetString(5),
            reader.IsDBNull(6) ? null : reader.GetString(6));
    }

    internal static async Task<ChargeReplay?> FindChargeAsync(
        NpgsqlConnection connection, NpgsqlTransaction? transaction, string key, CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("""
            SELECT id, enrollment_id, billing_month, amount_due, note
            FROM monthly_charges WHERE client_key=@key;
            """, connection, transaction);
        command.Parameters.AddWithValue("key", key);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        return new ChargeReplay(
            reader.GetGuid(0),
            reader.GetGuid(1),
            reader.GetFieldValue<DateOnly>(2),
            reader.GetDecimal(3),
            reader.IsDBNull(4) ? null : reader.GetString(4));
    }
}

internal sealed record PaymentReplay(
    Guid Id, Guid MonthlyChargeId, decimal Amount, DateTimeOffset PaidAt,
    string? Method, string? Reference, string? Note);

internal sealed record ChargeReplay(
    Guid Id, Guid EnrollmentId, DateOnly BillingMonth, decimal AmountDue, string? Note);
