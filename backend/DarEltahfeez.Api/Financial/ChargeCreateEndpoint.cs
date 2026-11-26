using System.Security.Claims;
using Npgsql;

namespace DarEltahfeez.Api;

/// <summary>FINAL 0.1: charge creation with an Idempotency-Key replay contract.</summary>
public static partial class DomainEndpoints
{
    internal static async Task<IResult> CreateChargeWithIdempotencyAsync(
        ChargeWriteRequest request,
        ClaimsPrincipal principal,
        NpgsqlDataSource db,
        HttpRequest httpRequest,
        CancellationToken ct)
    {
        if (request.EnrollmentId == Guid.Empty || !DomainEndpoints.TryMonth(request.BillingMonth, out var month))
            return Results.ValidationProblem(new Dictionary<string, string[]> { { "charge", ["حدد الالتحاق والشهر الصحيح."] } });
        if (!MoneyRules.TryNormalizeNonNegativeCurrency(request.AmountDue, out var amountDue))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["amountDue"] = ["المبلغ يتجاوز الحد المسموح أو لا يمكن تمثيله بدقة منزلتين عشريتين."] });

        var key = IdempotencySupport.ReadKey(httpRequest);
        await using var connection = await db.OpenConnectionAsync(ct);
        if (key is not null)
        {
            var replay = await IdempotencySupport.FindChargeAsync(connection, null, key, ct);
            if (replay is not null) return Replay(replay, principal);
        }

        await using var transaction = await connection.BeginTransactionAsync(ct);
        try
        {
            await using var command = new NpgsqlCommand("""
                INSERT INTO monthly_charges(enrollment_id,billing_month,amount_due,note,client_key)
                SELECT ce.id,@month,@amount,@note,@key
                FROM circle_enrollments ce
                JOIN students s ON s.id=ce.student_id
                JOIN circles c ON c.id=ce.circle_id
                WHERE ce.id=@enrollment AND ce.is_trashed=FALSE
                  AND s.is_trashed=FALSE AND c.is_trashed=FALSE
                  AND ce.starts_on<=(@month+INTERVAL '1 month - 1 day')::date
                  AND (ce.ends_on IS NULL OR ce.ends_on>=@month)
                  AND public.dar_enrollment_has_active_day_in_month(ce.id,@month)
                RETURNING id;
                """, connection, transaction);
            command.Parameters.AddWithValue("enrollment", request.EnrollmentId);
            command.Parameters.AddWithValue("month", month);
            command.Parameters.AddWithValue("amount", amountDue);
            DomainEndpoints.AddNullable(command, "note", request.Note);
            DomainEndpoints.AddNullable(command, "key", key);
            var chargeValue = await command.ExecuteScalarAsync(ct);
            if (chargeValue is null)
            {
                await transaction.RollbackAsync(ct);
                return Results.NotFound(new { message = "سجل الالتحاق غير موجود أو موجود في سلة المهملات." });
            }
            var id = (Guid)chargeValue;
            await using (var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'charge.create','monthly_charge',@id,jsonb_build_object('enrollmentId',@enrollment,'billingMonth',@month,'amountDue',@amount,'idempotencyKey',@key::text));", connection, transaction))
            {
                audit.Parameters.AddWithValue("actor", ActorId(principal));
                audit.Parameters.AddWithValue("id", id);
                audit.Parameters.AddWithValue("enrollment", request.EnrollmentId);
                audit.Parameters.AddWithValue("month", month);
                audit.Parameters.AddWithValue("amount", amountDue);
                AddNullable(audit, "key", key);
                await audit.ExecuteNonQueryAsync(ct);
            }
            await transaction.CommitAsync(ct);
            return Results.Created($"/api/charges/{id}", new
            {
                id,
                enrollmentId = request.EnrollmentId,
                billingMonth = month,
                amountDue = DomainEndpoints.CanReadFinance(principal) ? amountDue : (decimal?)null,
                note = request.Note
            });
        }
        catch (PostgresException ex) when (ex.SqlState == "23505")
        {
            await transaction.RollbackAsync(ct);
            if (key is not null)
            {
                var replay = await IdempotencySupport.FindChargeAsync(connection, null, key, ct);
                if (replay is not null) return Replay(replay, principal);
            }
            return Results.Conflict(new { message = "تم تحديد الاستحقاق لهذا الطالب والحلقة في الشهر نفسه بالفعل." });
        }
        catch (PostgresException ex) when (ex.SqlState == "23503")
        {
            await transaction.RollbackAsync(ct);
            return Results.NotFound(new { message = "سجل الالتحاق غير موجود." });
        }
    }

    private static IResult Replay(ChargeReplay replay, ClaimsPrincipal principal) => Results.Ok(new
    {
        id = replay.Id,
        enrollmentId = replay.EnrollmentId,
        billingMonth = replay.BillingMonth,
        amountDue = DomainEndpoints.CanReadFinance(principal) ? replay.AmountDue : (decimal?)null,
        note = replay.Note,
        replayed = true
    });
}
