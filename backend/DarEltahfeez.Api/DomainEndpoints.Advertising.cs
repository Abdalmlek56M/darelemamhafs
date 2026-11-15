using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private static void MapAdvertisingExpenses(WebApplication app)
    {
        app.MapGet("/api/advertising-expenses", async Task<IResult> (string? month, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!TryMonth(month, out var from)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
            var to = from.AddMonths(1); var rows = new List<object>();
            await using var cmd = db.CreateCommand("""
                SELECT a.id,a.circle_id,c.name,a.platform,a.start_date,a.days_count,a.daily_cost,a.total_amount,
                       period_calc.overlap_days,(a.daily_cost * period_calc.overlap_days) AS month_amount,a.note,a.created_at
                FROM advertising_expenses a JOIN circles c ON c.id=a.circle_id
                CROSS JOIN LATERAL (
                    SELECT GREATEST(0, LEAST(a.start_date + (a.days_count - 1), @to - 1) - GREATEST(a.start_date, @from) + 1) AS overlap_days
                ) period_calc
                WHERE a.start_date<@to AND (a.start_date + a.days_count - 1)>=@from AND a.is_trashed=FALSE AND c.is_trashed=FALSE
                ORDER BY a.start_date DESC,a.created_at DESC;
                """);
            cmd.Parameters.AddWithValue("from", from); cmd.Parameters.AddWithValue("to", to);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(new { id=reader.GetGuid(0), circleId=reader.GetGuid(1), circleName=reader.GetString(2), platform=reader.IsDBNull(3)?null:reader.GetString(3), startDate=reader.GetFieldValue<DateOnly>(4), daysCount=reader.GetInt32(5), dailyCost=reader.GetDecimal(6), totalAmount=reader.GetDecimal(7), overlapDays=reader.GetInt32(8), monthAmount=reader.GetDecimal(9), note=reader.IsDBNull(10)?null:reader.GetString(10), createdAt=reader.GetFieldValue<DateTimeOffset>(11) });
            return Results.Ok(rows);
        }).RequireAuthorization("finance.read");

        app.MapPost("/api/advertising-expenses", async Task<IResult> (AdvertisingExpenseWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (request.CircleId == Guid.Empty || request.StartDate == default || request.DaysCount is < 1 or > 3650 || request.Platform?.Length > 120 || request.Note?.Length > 5000)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["advertising"] = ["حدد الحلقة والتاريخ والمدة والتكلفة اليومية بشكل صحيح. المدة من يوم إلى 3650 يومًا." ] });
            var generatedTotalDailyLimit = decimal.Floor(MoneyRules.MaximumNumeric14Currency * 100m / request.DaysCount) / 100m;
            var maximumDailyCost = Math.Min(MoneyRules.MaximumNumeric12Currency, generatedTotalDailyLimit);
            if (!MoneyRules.TryNormalizeNonNegativeCurrency(request.DailyCost, out var dailyCost, maximumDailyCost))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["dailyCost"] = ["التكلفة اليومية تتجاوز الحد المسموح لمدة الإعلان أو لا يمكن تمثيلها بدقة منزلتين عشريتين."] });
            await using var cmd = db.CreateCommand("""
                INSERT INTO advertising_expenses(circle_id,platform,start_date,days_count,daily_cost,note,recorded_by)
                SELECT c.id,@platform,@date,@days,@daily,@note,@actor FROM circles c WHERE c.id=@circle
                RETURNING id,total_amount;
                """);
            cmd.Parameters.AddWithValue("circle", request.CircleId); AddNullable(cmd,"platform",request.Platform); cmd.Parameters.AddWithValue("date",request.StartDate); cmd.Parameters.AddWithValue("days",request.DaysCount); cmd.Parameters.AddWithValue("daily",dailyCost); AddNullable(cmd,"note",request.Note); cmd.Parameters.AddWithValue("actor",ActorId(principal));
            try
            {
                await using var reader=await cmd.ExecuteReaderAsync(ct);
                if(!await reader.ReadAsync(ct))return Results.NotFound(new{message="الحلقة المحددة غير موجودة."});
                return Results.Created("/api/advertising-expenses",new{id=reader.GetGuid(0),totalAmount=CanReadFinance(principal) ? reader.GetDecimal(1) : (decimal?)null});
            }
            catch(PostgresException ex) when(ex.SqlState=="23503"){return Results.Conflict(new{message="تعذر ربط المصروف بالحلقة المحددة."});}
        }).RequireAuthorization("finance.create");

        app.MapDelete("/api/advertising-expenses/{id:guid}", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var conn=await db.OpenConnectionAsync(ct);await using var tx=await conn.BeginTransactionAsync(ct);
            decimal amount;Guid circleId;
            await using(var del=new NpgsqlCommand("DELETE FROM advertising_expenses WHERE id=@id RETURNING circle_id,total_amount;",conn,tx))
            {del.Parameters.AddWithValue("id",id);await using var reader=await del.ExecuteReaderAsync(ct);if(!await reader.ReadAsync(ct))return Results.NotFound();circleId=reader.GetGuid(0);amount=reader.GetDecimal(1);}
            await using(var audit=new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'advertising.delete','advertising_expense',@id,jsonb_build_object('circleId',@circle,'totalAmount',@amount));",conn,tx))
            {audit.Parameters.AddWithValue("actor",ActorId(principal));audit.Parameters.AddWithValue("id",id);audit.Parameters.AddWithValue("circle",circleId);audit.Parameters.AddWithValue("amount",amount);await audit.ExecuteNonQueryAsync(ct);}
            await tx.CommitAsync(ct);return Results.Ok(new{id,deleted=true});
        }).RequireAuthorization("finance.delete");
    }
}
