using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private static void MapReports(WebApplication app)
    {
        app.MapGet("/api/collection-reports",async Task<IResult> (string? month,NpgsqlDataSource db,CancellationToken ct)=>
        {
            await using var cmd=db.CreateCommand("SELECT id,title,billing_month,created_at,saved_by FROM collection_reports WHERE is_trashed=FALSE AND (@month::date IS NULL OR billing_month=@month::date) ORDER BY created_at DESC LIMIT 100;");
            DateOnly? billingMonth=null;if(!string.IsNullOrWhiteSpace(month)){if(!TryMonth(month,out var parsed))return Results.ValidationProblem(new Dictionary<string,string[]>{{"month",["حدد الشهر بصيغة YYYY-MM."]}});billingMonth=parsed;}
            cmd.Parameters.AddWithValue("month",billingMonth.HasValue?(object)billingMonth.Value:DBNull.Value);
            var rows=new List<object>();await using var reader=await cmd.ExecuteReaderAsync(ct);while(await reader.ReadAsync(ct))rows.Add(new{id=reader.GetGuid(0),title=reader.GetString(1),billingMonth=reader.GetFieldValue<DateOnly>(2),createdAt=reader.GetFieldValue<DateTimeOffset>(3),savedBy=reader.IsDBNull(4)?(Guid?)null:reader.GetGuid(4)});
            return Results.Ok(rows);
        }).RequireAuthorization("finance.read");

        app.MapPost("/api/collection-reports",async Task<IResult> (CollectionReportCreateRequest request,ClaimsPrincipal principal,NpgsqlDataSource db,CancellationToken ct)=>
        {
            if(!TryMonth(request.BillingMonth,out var month))return Results.ValidationProblem(new Dictionary<string,string[]>{{"billingMonth",["حدد الشهر بصيغة YYYY-MM."]}});
            var collection=await LoadCollections(db,month,ct);
            var title=string.IsNullOrWhiteSpace(request.Title)?$"تقرير تحصيل {month:yyyy-MM}":request.Title.Trim();
            var snapshot=new {schoolName="دار الإمام حفص للقرآن والتجويد",billingMonth=month,generatedAt=DateTimeOffset.UtcNow,rows=collection,totalDue=collection.Sum(x=>x.AmountDue),totalPaid=collection.Sum(x=>x.PaidAmount),totalBalance=collection.Sum(x=>x.Balance),rowCount=collection.Length};
            var json=JsonSerializer.Serialize(snapshot, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            await using var cmd=db.CreateCommand("INSERT INTO collection_reports(title,billing_month,snapshot,saved_by) VALUES(@title,@month,@snapshot,@actor) RETURNING id,created_at;");
            cmd.Parameters.AddWithValue("title",title);cmd.Parameters.AddWithValue("month",month);cmd.Parameters.AddWithValue("snapshot",NpgsqlDbType.Jsonb, json);cmd.Parameters.AddWithValue("actor",ActorId(principal));
            await using var reader=await cmd.ExecuteReaderAsync(ct);await reader.ReadAsync(ct);var id=reader.GetGuid(0);var created=reader.GetFieldValue<DateTimeOffset>(1);
            return Results.Created($"/api/collection-reports/{id}",new{id,title,billingMonth=month,createdAt=created});
        }).RequireAuthorization("finance.create");

        app.MapGet("/api/collection-reports/{id:guid}",async Task<IResult> (Guid id,NpgsqlDataSource db,CancellationToken ct)=>
        {
            await using var cmd=db.CreateCommand("SELECT id,title,billing_month,snapshot,created_at FROM collection_reports WHERE id=@id AND is_trashed=FALSE;");cmd.Parameters.AddWithValue("id",id);
            await using var reader=await cmd.ExecuteReaderAsync(ct);if(!await reader.ReadAsync(ct))return Results.NotFound();
            var snapshot=JsonDocument.Parse(reader.GetString(3)).RootElement.Clone();
            return Results.Ok(new{id,title=reader.GetString(1),billingMonth=reader.GetFieldValue<DateOnly>(2),snapshot,createdAt=reader.GetFieldValue<DateTimeOffset>(4)});
        }).RequireAuthorization("finance.read");

        app.MapDelete("/api/collection-reports/{id:guid}",async Task<IResult> (Guid id,NpgsqlDataSource db,CancellationToken ct)=>
        {
            await using var cmd=db.CreateCommand("DELETE FROM collection_reports WHERE id=@id RETURNING id;");cmd.Parameters.AddWithValue("id",id);
            if (await cmd.ExecuteScalarAsync(ct) is null) return Results.NotFound();
            return Results.Ok(new { id, deleted = true });
        }).RequireAuthorization("finance.delete");
    }
}
