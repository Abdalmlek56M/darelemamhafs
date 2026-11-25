using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class SystemAdminEndpoints
{
    internal static void MapPayroll(WebApplication app)
    {
        app.MapGet("/api/admin/payroll/lock", async Task<IResult> (string? month, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!TryPayrollMonth(month, out var billingMonth))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
            return Results.Ok(await LoadPayrollLockAsync(db, billingMonth, ct));
        }).RequireAuthorization("finance.read");

        app.MapPost("/api/admin/payroll/lock", async Task<IResult> (PayrollLockRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!TryPayrollMonth(request.Month, out var billingMonth))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
            if (string.IsNullOrWhiteSpace(request.Note))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["note"] = ["اكتب سبب قفل المسير."] });

            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            await using (var command = new NpgsqlCommand("""
                INSERT INTO payroll_locks(billing_month,is_locked,locked_by,locked_at,note,unlocked_by,unlocked_at,unlock_note)
                VALUES(@month,TRUE,@actor,now(),@note,NULL,NULL,NULL)
                ON CONFLICT(billing_month) DO UPDATE SET
                    is_locked=TRUE,locked_by=@actor,locked_at=now(),note=@note,
                    unlocked_by=NULL,unlocked_at=NULL,unlock_note=NULL;
                """, connection, transaction))
            {
                command.Parameters.AddWithValue("month", billingMonth);
                command.Parameters.AddWithValue("actor", DbGuid(ActorId(principal)));
                command.Parameters.AddWithValue("note", request.Note.Trim());
                await command.ExecuteNonQueryAsync(ct);
            }
            await InsertPayrollAuditAsync(connection, transaction, principal, "payroll.lock", billingMonth,
                JsonSerializer.Serialize(new { note = request.Note.Trim() }), ct);
            await transaction.CommitAsync(ct);
            return Results.Ok(await LoadPayrollLockAsync(db, billingMonth, ct));
        }).RequireAuthorization("finance.edit").AddEndpointFilter<ScopedAccessEndpointFilter>();

        app.MapPost("/api/admin/payroll/unlock", async Task<IResult> (PayrollLockRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!TryPayrollMonth(request.Month, out var billingMonth))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
            if (string.IsNullOrWhiteSpace(request.Note))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["note"] = ["اكتب سبب فتح المسير."] });

            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            await using (var command = new NpgsqlCommand("""
                UPDATE payroll_locks SET is_locked=FALSE,unlocked_by=@actor,unlocked_at=now(),unlock_note=@note
                WHERE billing_month=@month;
                """, connection, transaction))
            {
                command.Parameters.AddWithValue("month", billingMonth);
                command.Parameters.AddWithValue("actor", DbGuid(ActorId(principal)));
                command.Parameters.AddWithValue("note", request.Note.Trim());
                if (await command.ExecuteNonQueryAsync(ct) == 0)
                {
                    await transaction.RollbackAsync(ct);
                    return Results.NotFound(new { message = "لا يوجد قفل لهذا الشهر." });
                }
            }
            await InsertPayrollAuditAsync(connection, transaction, principal, "payroll.unlock", billingMonth,
                JsonSerializer.Serialize(new { note = request.Note.Trim() }), ct);
            await transaction.CommitAsync(ct);
            return Results.Ok(await LoadPayrollLockAsync(db, billingMonth, ct));
        }).RequireAuthorization("users.manage").AddEndpointFilter<ScopedAccessEndpointFilter>();
    }

    internal static Task<bool> IsPayrollLockedAsync(NpgsqlDataSource db, DateOnly sessionDate, CancellationToken ct) =>
        PayrollLockService.IsLockedAsync(db, sessionDate, ct);

    private static async Task<object> LoadPayrollLockAsync(NpgsqlDataSource db, DateOnly month, CancellationToken ct)
    {
        await using var command = db.CreateCommand("""
            SELECT billing_month,is_locked,locked_at,note,unlocked_at,unlock_note
            FROM payroll_locks WHERE billing_month=@month;
            """);
        command.Parameters.AddWithValue("month", month);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
            return new { month = month.ToString("yyyy-MM", CultureInfo.InvariantCulture), isLocked = false, lockedAt = (DateTimeOffset?)null, note = (string?)null, unlockedAt = (DateTimeOffset?)null, unlockNote = (string?)null };
        return new
        {
            month = reader.GetFieldValue<DateOnly>(0).ToString("yyyy-MM", CultureInfo.InvariantCulture),
            isLocked = reader.GetBoolean(1),
            lockedAt = reader.GetFieldValue<DateTimeOffset>(2),
            note = reader.IsDBNull(3) ? null : reader.GetString(3),
            unlockedAt = reader.IsDBNull(4) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(4),
            unlockNote = reader.IsDBNull(5) ? null : reader.GetString(5)
        };
    }

    private static async Task InsertPayrollAuditAsync(NpgsqlConnection connection, NpgsqlTransaction transaction,
        ClaimsPrincipal principal, string action, DateOnly month, string details, CancellationToken ct)
    {
        await using var audit = new NpgsqlCommand("""
            INSERT INTO audit_log(actor_user_id,actor_display_name,action_code,entity_type,entity_id,details,request_path,http_method,can_restore)
            VALUES(@actor,@name,@action,'payroll_lock',NULL,@details::jsonb,'/api/admin/payroll','POST',FALSE);
            """, connection, transaction);
        audit.Parameters.AddWithValue("actor", DbGuid(ActorId(principal)));
        audit.Parameters.AddWithValue("name", (object?)principal.FindFirstValue("display_name") ?? DBNull.Value);
        audit.Parameters.AddWithValue("action", action);
        audit.Parameters.AddWithValue("details", details);
        await audit.ExecuteNonQueryAsync(ct);
    }

    private static bool TryPayrollMonth(string? value, out DateOnly month)
    {
        month = default;
        if (string.IsNullOrWhiteSpace(value)) return false;
        return DateOnly.TryParseExact($"{value.Trim()}-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out month);
    }
}

public sealed record PayrollLockRequest(string? Month, string? Note);
