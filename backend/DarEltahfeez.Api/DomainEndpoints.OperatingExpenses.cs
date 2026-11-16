using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private static void MapOperatingExpenses(WebApplication app)
    {
        app.MapGet("/api/operating-expenses", async Task<IResult> (string? month, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!TryMonth(month, out var from)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
            var to = from.AddMonths(1);
            var rows = new List<object>();
            await using var cmd = db.CreateCommand("""
                SELECT e.id,e.expense_date,e.category,e.description,e.amount,e.circle_id,c.name,e.note,e.created_at
                FROM operating_expenses e LEFT JOIN circles c ON c.id=e.circle_id
                WHERE e.expense_date>=@from AND e.expense_date<@to AND e.is_trashed=FALSE AND (e.circle_id IS NULL OR COALESCE(c.is_trashed,FALSE)=FALSE)
                ORDER BY e.expense_date DESC,e.created_at DESC;
                """);
            cmd.Parameters.AddWithValue("from", from); cmd.Parameters.AddWithValue("to", to);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(new
            {
                id = reader.GetGuid(0), expenseDate = reader.GetFieldValue<DateOnly>(1), category = reader.GetString(2), description = reader.GetString(3),
                amount = reader.GetDecimal(4), circleId = reader.IsDBNull(5) ? (Guid?)null : reader.GetGuid(5), circleName = reader.IsDBNull(6) ? null : reader.GetString(6),
                note = reader.IsDBNull(7) ? null : reader.GetString(7), createdAt = reader.GetFieldValue<DateTimeOffset>(8)
            });
            return Results.Ok(rows);
        }).RequireAuthorization("finance.read");

        app.MapPost("/api/operating-expenses", async Task<IResult> (OperatingExpenseWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!MoneyRules.TryNormalizePositiveCurrency(request.Amount, out var normalizedAmount, MoneyRules.MaximumNumeric14Currency))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["amount"] = ["اكتب مبلغًا أكبر من صفر لا يتجاوز الحد المسموح، بدقة منزلتين عشريتين."] });
            var normalizedRequest = request with { Amount = normalizedAmount };
            var error = ValidateOperatingExpense(normalizedRequest);
            if (error is not null) return Results.ValidationProblem(error);
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            try
            {
                Guid id; DateTimeOffset createdAt;
                await using (var insert = new NpgsqlCommand("""
                    INSERT INTO operating_expenses(expense_date,category,description,amount,circle_id,note,recorded_by)
                    VALUES(@date,@category,@description,@amount,@circle,@note,@actor)
                    RETURNING id,created_at;
                    """, conn, tx))
                {
                    AddOperatingExpenseParams(insert, normalizedRequest, principal);
                    await using var reader = await insert.ExecuteReaderAsync(ct); await reader.ReadAsync(ct);
                    id = reader.GetGuid(0); createdAt = reader.GetFieldValue<DateTimeOffset>(1);
                }
                await using (var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'operating_expense.create','operating_expense',@id,jsonb_build_object('category',@category,'description',@description,'amount',@amount,'expenseDate',@date,'circleId',@circle));", conn, tx))
                {
                    audit.Parameters.AddWithValue("actor", ActorId(principal)); audit.Parameters.AddWithValue("id", id);
                    audit.Parameters.AddWithValue("category", request.Category.Trim()); audit.Parameters.AddWithValue("description", request.Description.Trim());
                    audit.Parameters.AddWithValue("amount", normalizedAmount); audit.Parameters.AddWithValue("date", request.ExpenseDate); AddNullableGuid(audit, "circle", request.CircleId);
                    await audit.ExecuteNonQueryAsync(ct);
                }
                await tx.CommitAsync(ct);
                return Results.Created($"/api/operating-expenses/{id}", new { id, createdAt });
            }
            catch (PostgresException ex) when (ex.SqlState == "23503")
            {
                await tx.RollbackAsync(ct);
                return Results.Conflict(new { message = "الحلقة المرتبطة بالمصروف غير موجودة؛ حدّث القائمة ثم أعد المحاولة." });
            }
        }).RequireAuthorization("finance.create");

        app.MapPut("/api/operating-expenses/{id:guid}", async Task<IResult> (Guid id, OperatingExpenseWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!MoneyRules.TryNormalizePositiveCurrency(request.Amount, out var normalizedAmount, MoneyRules.MaximumNumeric14Currency))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["amount"] = ["اكتب مبلغًا أكبر من صفر لا يتجاوز الحد المسموح، بدقة منزلتين عشريتين."] });
            var normalizedRequest = request with { Amount = normalizedAmount };
            var error = ValidateOperatingExpense(normalizedRequest);
            if (error is not null) return Results.ValidationProblem(error);
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            try
            {
                await using (var update = new NpgsqlCommand("""
                    UPDATE operating_expenses SET expense_date=@date,category=@category,description=@description,amount=@amount,circle_id=@circle,note=@note,updated_by=@actor,updated_at=now()
                    WHERE id=@id RETURNING id;
                    """, conn, tx))
                {
                    AddOperatingExpenseParams(update, normalizedRequest, principal); update.Parameters.AddWithValue("id", id);
                    if (await update.ExecuteScalarAsync(ct) is null) return Results.NotFound(new { message = "المصروف غير موجود." });
                }
                await using (var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'operating_expense.update','operating_expense',@id,jsonb_build_object('category',@category,'description',@description,'amount',@amount,'expenseDate',@date,'circleId',@circle));", conn, tx))
                {
                    audit.Parameters.AddWithValue("actor", ActorId(principal)); audit.Parameters.AddWithValue("id", id);
                    audit.Parameters.AddWithValue("category", request.Category.Trim()); audit.Parameters.AddWithValue("description", request.Description.Trim());
                    audit.Parameters.AddWithValue("amount", normalizedAmount); audit.Parameters.AddWithValue("date", request.ExpenseDate); AddNullableGuid(audit, "circle", request.CircleId);
                    await audit.ExecuteNonQueryAsync(ct);
                }
                await tx.CommitAsync(ct); return Results.Ok(new { id, updated = true });
            }
            catch (PostgresException ex) when (ex.SqlState == "23503")
            {
                await tx.RollbackAsync(ct); return Results.Conflict(new { message = "الحلقة المرتبطة بالمصروف غير موجودة؛ حدّث القائمة ثم أعد المحاولة." });
            }
        }).RequireAuthorization("finance.edit", "finance.read");

    }

    private static Dictionary<string, string[]>? ValidateOperatingExpense(OperatingExpenseWriteRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        if (request.ExpenseDate == default) errors["expenseDate"] = ["حدد تاريخ المصروف."];
        if (string.IsNullOrWhiteSpace(request.Category) || request.Category.Trim().Length > 100) errors["category"] = ["التصنيف مطلوب وبحد أقصى 100 حرف."];
        if (string.IsNullOrWhiteSpace(request.Description) || request.Description.Trim().Length > 240) errors["description"] = ["وصف المصروف مطلوب وبحد أقصى 240 حرفًا."];
        if (request.Amount <= 0) errors["amount"] = ["اكتب مبلغًا أكبر من صفر."];
        if (request.Note?.Length > 5000) errors["note"] = ["الملاحظات طويلة جدًا."];
        return errors.Count == 0 ? null : errors;
    }

    private static void AddOperatingExpenseParams(NpgsqlCommand cmd, OperatingExpenseWriteRequest request, ClaimsPrincipal principal)
    {
        cmd.Parameters.AddWithValue("date", request.ExpenseDate); cmd.Parameters.AddWithValue("category", request.Category.Trim());
        cmd.Parameters.AddWithValue("description", request.Description.Trim()); cmd.Parameters.AddWithValue("amount", request.Amount);
        AddNullableGuid(cmd, "circle", request.CircleId); AddNullable(cmd, "note", request.Note); cmd.Parameters.AddWithValue("actor", ActorId(principal));
    }
}