using System.Security.Claims;
using Npgsql;

namespace DarEltahfeez.Api;

/// <summary>FINAL 0.1: JSON payment creation with an Idempotency-Key replay contract.</summary>
public static partial class DomainEndpoints
{
    internal static async Task<IResult> CreatePaymentWithIdempotencyAsync(
        PaymentWriteRequest request,
        ClaimsPrincipal principal,
        NpgsqlDataSource db,
        HttpRequest httpRequest,
        CancellationToken ct)
    {
        if (request.MonthlyChargeId == Guid.Empty)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["amount"] = ["حدد الاستحقاق واكتب مبلغًا صحيحًا أكبر من صفر وبحد أقصى 9,999,999,999.99 ج.م."] });
        if (!MoneyRules.TryNormalizePaymentAmount(request.Amount, out var paymentAmount))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["amount"] = ["حدد الاستحقاق واكتب مبلغًا صحيحًا أكبر من صفر وبحد أقصى 9,999,999,999.99 ج.م."] });

        var key = IdempotencySupport.ReadKey(httpRequest);
        await using var connection = await db.OpenConnectionAsync(ct);
        if (key is not null)
        {
            var replay = await IdempotencySupport.FindPaymentAsync(connection, null, key, ct);
            if (replay is not null) return PaymentReplayResult(replay, principal);
        }

        await using var transaction = await connection.BeginTransactionAsync(ct);
        try
        {
            decimal due, paid;
            await using (var check = new NpgsqlCommand("SELECT amount_due FROM monthly_charges WHERE id=@id AND is_trashed=FALSE AND voided_at IS NULL FOR UPDATE;", connection, transaction))
            {
                check.Parameters.AddWithValue("id", request.MonthlyChargeId);
                var value = await check.ExecuteScalarAsync(ct);
                if (value is null)
                {
                    await transaction.RollbackAsync(ct);
                    return Results.NotFound(new { message = "الاستحقاق غير موجود." });
                }
                due = Convert.ToDecimal(value, System.Globalization.CultureInfo.InvariantCulture);
            }
            await using (var sum = new NpgsqlCommand("SELECT COALESCE(SUM(amount),0) FROM payments WHERE monthly_charge_id=@id AND is_trashed=FALSE AND voided_at IS NULL;", connection, transaction))
            {
                sum.Parameters.AddWithValue("id", request.MonthlyChargeId);
                paid = Convert.ToDecimal(await sum.ExecuteScalarAsync(ct) ?? 0m, System.Globalization.CultureInfo.InvariantCulture);
            }
            if (MoneyRules.ExceedsOutstanding(paymentAmount, due, paid))
            {
                await transaction.RollbackAsync(ct);
                return Results.Conflict(new { message = CanReadFinance(principal) ? $"المبلغ أكبر من المتبقي ({MoneyRules.RoundCurrency(due - paid):0.00}). سجّل مبلغًا مساويًا أو أقل من المتبقي." : "المبلغ يتجاوز المتبقي المسموح لهذا الاستحقاق." });
            }
            var paymentId = Guid.NewGuid();
            var paidAt = DateTimeOffset.UtcNow;
            await using (var insert = new NpgsqlCommand("INSERT INTO payments(id,monthly_charge_id,amount,paid_at,method,reference,note,recorded_by,client_key) VALUES(@id,@charge,@amount,@date,@method,@reference,@note,@actor,@key);", connection, transaction))
            {
                insert.Parameters.AddWithValue("id", paymentId);
                insert.Parameters.AddWithValue("charge", request.MonthlyChargeId);
                insert.Parameters.AddWithValue("amount", paymentAmount);
                insert.Parameters.AddWithValue("date", paidAt);
                AddNullable(insert, "method", request.Method);
                AddNullable(insert, "reference", request.Reference);
                AddNullable(insert, "note", request.Note);
                insert.Parameters.AddWithValue("actor", ActorId(principal));
                AddNullable(insert, "key", key);
                await insert.ExecuteNonQueryAsync(ct);
            }
            await transaction.CommitAsync(ct);
            return Results.Created($"/api/payments/{paymentId}", new
            {
                id = paymentId,
                monthlyChargeId = request.MonthlyChargeId,
                amount = CanReadFinance(principal) ? paymentAmount : (decimal?)null,
                paidAt,
                method = request.Method,
                reference = request.Reference,
                note = request.Note
            });
        }
        catch (PostgresException ex) when (ex.SqlState == "23505" && key is not null)
        {
            await transaction.RollbackAsync(ct);
            var replay = await IdempotencySupport.FindPaymentAsync(connection, null, key, ct);
            if (replay is not null) return PaymentReplayResult(replay, principal);
            throw;
        }
    }

    private static IResult PaymentReplayResult(PaymentReplay replay, ClaimsPrincipal principal) => Results.Ok(new
    {
        id = replay.Id,
        monthlyChargeId = replay.MonthlyChargeId,
        amount = CanReadFinance(principal) ? replay.Amount : (decimal?)null,
        paidAt = replay.PaidAt,
        method = replay.Method,
        reference = replay.Reference,
        note = replay.Note,
        replayed = true
    });
}
