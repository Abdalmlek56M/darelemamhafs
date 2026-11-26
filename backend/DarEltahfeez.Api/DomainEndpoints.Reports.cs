using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using Dar.Common.Pagination;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private static void MapReports(WebApplication app)
    {
        app.MapGet("/api/collection-reports",async Task<IResult> (string? month,int? page,int? pageSize,HttpContext http,NpgsqlDataSource db,CancellationToken ct)=>
        {
            var paging=new PageRequest(page,pageSize);var paged=page is not null||pageSize is not null;var take=paged?paging.PageSize:100;await using var cmd=db.CreateCommand("SELECT id,title,billing_month,created_at,saved_by,COUNT(*) OVER() AS total FROM collection_reports WHERE is_trashed=FALSE AND (@month::date IS NULL OR billing_month=@month::date) ORDER BY created_at DESC,id DESC LIMIT @take OFFSET @skip;");cmd.Parameters.AddWithValue("take",take);cmd.Parameters.AddWithValue("skip",paged?paging.Offset:0L);
            DateOnly? billingMonth=null;if(!string.IsNullOrWhiteSpace(month)){if(!TryMonth(month,out var parsed))return Results.ValidationProblem(new Dictionary<string,string[]>{{"month",["حدد الشهر بصيغة YYYY-MM."]}});billingMonth=parsed;}
            cmd.Parameters.AddWithValue("month",billingMonth.HasValue?(object)billingMonth.Value:DBNull.Value);
            var rows=new List<object>();long total=0;await using(var reader=await cmd.ExecuteReaderAsync(ct)){while(await reader.ReadAsync(ct)){total=reader.ReadTotal();rows.Add(new{id=reader.GetGuid(0),title=reader.GetString(1),billingMonth=reader.GetFieldValue<DateOnly>(2),createdAt=reader.GetFieldValue<DateTimeOffset>(3),savedBy=reader.IsDBNull(4)?(Guid?)null:reader.GetGuid(4)});}}
            total=await PaginationRules.EnsureTotalAsync(cmd,total,paged,ct);PaginationHeaderWriter.Write(http.Response,total,paging,rows.Count,paged);
            return Results.Ok(rows);
        }).RequireAuthorization("finance.read");

        app.MapPost("/api/collection-reports",async Task<IResult> (CollectionReportCreateRequest request,ClaimsPrincipal principal,NpgsqlDataSource db,CancellationToken ct)=>
        {
            if(!TryMonth(request.BillingMonth,out var month))return Results.ValidationProblem(new Dictionary<string,string[]>{{"billingMonth",["حدد الشهر بصيغة YYYY-MM."]}});
            var (collection,_) = await LoadCollections(db,month,ct);
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

    }
}