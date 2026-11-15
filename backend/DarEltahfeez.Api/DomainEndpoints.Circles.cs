using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private static void MapCircles(WebApplication app)
    {
        var route=app.MapGroup("/api/circles");
        route.MapGet("",async Task<IResult> (ClaimsPrincipal principal,NpgsqlDataSource db,CancellationToken ct)=>
        {
            var financeVisible = CanReadFinance(principal);
            var rows=new List<CircleResponse>();
            await using var cmd=db.CreateCommand("""
              SELECT c.id,c.circle_code,c.name,c.teacher_id,COALESCE(t.full_name,''),c.monthly_fee,c.schedule_text,c.is_active,c.created_at,c.updated_at,
                 (SELECT COUNT(*) FROM circle_enrollments ce WHERE ce.circle_id=c.id AND ce.status='active' AND ce.is_trashed=FALSE),c.starts_on
              FROM circles c LEFT JOIN teachers t ON t.id=c.teacher_id WHERE c.is_trashed=FALSE ORDER BY c.is_active DESC,c.starts_on,c.name;
              """);
            await using var reader=await cmd.ExecuteReaderAsync(ct);
            while(await reader.ReadAsync(ct)) rows.Add(ReadCircle(reader, financeVisible));
            return Results.Ok(rows);
        }).RequireAuthorization("circles.read");

        route.MapGet("/{id:guid}/students", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var financeVisible = CanReadFinance(principal);
            await using var cmd = db.CreateCommand("""
              SELECT ce.id,ce.student_id,s.student_code,s.full_name,s.age_years,ce.starts_on,ce.ends_on,ce.status,ce.agreed_monthly_fee,
                     COALESCE(mc.amount_due,0),COALESCE(pay.paid,0),mc.id
              FROM circle_enrollments ce JOIN students s ON s.id=ce.student_id
              LEFT JOIN monthly_charges mc ON mc.enrollment_id=ce.id AND mc.billing_month=date_trunc('month',CURRENT_DATE)::date AND mc.is_trashed=FALSE
              LEFT JOIN LATERAL(SELECT COALESCE(SUM(amount),0) paid FROM payments WHERE monthly_charge_id=mc.id AND is_trashed=FALSE) pay ON TRUE
              WHERE ce.circle_id=@id AND ce.is_trashed=FALSE AND s.is_trashed=FALSE AND EXISTS(SELECT 1 FROM circles active_circle WHERE active_circle.id=ce.circle_id AND active_circle.is_trashed=FALSE) ORDER BY CASE ce.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,s.full_name;
              """);
            cmd.Parameters.AddWithValue("id", id);
            var rows = new List<object>();
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(new {
                enrollmentId=reader.GetGuid(0), studentId=reader.GetGuid(1), studentCode=reader.GetString(2), studentName=reader.GetString(3),
                ageYears=reader.IsDBNull(4)?(int?)null:reader.GetInt32(4), startsOn=reader.GetFieldValue<DateOnly>(5),
                endsOn=reader.IsDBNull(6)?(DateOnly?)null:reader.GetFieldValue<DateOnly>(6), enrollmentStatus=reader.GetString(7),
                agreedMonthlyFee=financeVisible ? reader.GetDecimal(8) : (decimal?)null, currentMonthDue=financeVisible ? reader.GetDecimal(9) : (decimal?)null, currentMonthPaid=financeVisible ? reader.GetDecimal(10) : (decimal?)null,
                chargeId=reader.IsDBNull(11)?(Guid?)null:reader.GetGuid(11)
            });
            return Results.Ok(rows);
        }).RequireAuthorization("circles.read");

        route.MapPost("",async Task<IResult> (CircleWriteRequest request,ClaimsPrincipal principal,NpgsqlDataSource db,CancellationToken ct)=>
        {
            var errors=ValidateCircle(request);if(errors is not null)return Results.ValidationProblem(errors);
            var canEditFinancials = CanEditFinancialValues(principal);
            if (!canEditFinancials && request.MonthlyFee is not null) return Results.Forbid();
            var monthlyFee = 0m;
            if (canEditFinancials && request.MonthlyFee is null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["monthlyFee"] = ["الرسوم الشهرية مطلوبة عند إنشاء الحلقة مع صلاحية التعديل المالي."] });
            if (canEditFinancials && !MoneyRules.TryNormalizeNonNegativeCurrency(request.MonthlyFee!.Value, out monthlyFee))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["monthlyFee"] = ["رسوم الحلقة تتجاوز الحد المسموح أو لا يمكن تمثيلها بدقة منزلتين عشريتين."] });
            var code=string.IsNullOrWhiteSpace(request.CircleCode)?NewCode("CIR"):request.CircleCode.Trim();
            try
            {
                await using var cmd=db.CreateCommand("INSERT INTO circles(circle_code,name,teacher_id,monthly_fee,schedule_text,is_active,starts_on) VALUES(@code,@name,@teacher,@fee,@schedule,@active,@starts) RETURNING id;");
                cmd.Parameters.AddWithValue("code",code);cmd.Parameters.AddWithValue("name",request.Name.Trim()); AddNullableGuid(cmd,"teacher",request.TeacherId);
                cmd.Parameters.AddWithValue("fee",monthlyFee);AddNullable(cmd,"schedule",request.ScheduleText);cmd.Parameters.AddWithValue("active",request.IsActive);cmd.Parameters.AddWithValue("starts",request.StartsOn);
                var id=(Guid)(await cmd.ExecuteScalarAsync(ct)??throw new InvalidOperationException("لم يرجع سجل الحلقة."));
                return Results.Created($"/api/circles/{id}",await LoadCircle(db,id,CanReadFinance(principal),ct));
            }
            catch(PostgresException ex) when(ex.SqlState=="23505"){return Results.Conflict(new{message="كود الحلقة مستخدم بالفعل."});}
            catch(PostgresException ex) when(ex.SqlState=="23503"){return Results.ValidationProblem(new Dictionary<string,string[]>{{"teacherId",["المعلمة المختارة غير موجودة."]}});}
            catch(PostgresException ex) when(ex.SqlState=="23514" && ex.ConstraintName=="ck_teacher_schedule_no_overlap")
            { return Results.Conflict(new { message = "لا يمكن إسناد هذه المعلمة للحلقة؛ لديها حصة أخرى تتداخل مع أحد مواعيد الحلقة. عدّل المواعيد أولًا." }); }
        }).RequireAuthorization("circles.create");

        route.MapPut("/{id:guid}",async Task<IResult> (Guid id,CircleWriteRequest request,ClaimsPrincipal principal,NpgsqlDataSource db,CancellationToken ct)=>
        {
            var errors=ValidateCircle(request);if(errors is not null)return Results.ValidationProblem(errors);
            var canEditFinancials = CanEditFinancialValues(principal);
            if (!canEditFinancials && request.MonthlyFee is not null) return Results.Forbid();
            decimal? monthlyFee = null;
            if (canEditFinancials) { if (request.MonthlyFee is null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["monthlyFee"] = ["الرسوم الشهرية مطلوبة عند تعديل البيانات المالية."] }); if (!MoneyRules.TryNormalizeNonNegativeCurrency(request.MonthlyFee.Value, out var normalizedFee))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["monthlyFee"] = ["رسوم الحلقة تتجاوز الحد المسموح أو لا يمكن تمثيلها بدقة منزلتين عشريتين."] }); monthlyFee = normalizedFee; }
            try
            {
                await using var cmd=db.CreateCommand("UPDATE circles SET circle_code=COALESCE(NULLIF(@code,''),circle_code),name=@name,teacher_id=@teacher,monthly_fee=COALESCE(@fee,monthly_fee),schedule_text=@schedule,is_active=@active,starts_on=@starts,updated_at=now() WHERE id=@id AND is_trashed=FALSE;");
                cmd.Parameters.AddWithValue("id",id);cmd.Parameters.AddWithValue("code",request.CircleCode?.Trim()??string.Empty);cmd.Parameters.AddWithValue("name",request.Name.Trim());AddNullableGuid(cmd,"teacher",request.TeacherId);
                cmd.Parameters.AddWithValue("fee",monthlyFee.HasValue ? (object)monthlyFee.Value : DBNull.Value);AddNullable(cmd,"schedule",request.ScheduleText);cmd.Parameters.AddWithValue("active",request.IsActive);cmd.Parameters.AddWithValue("starts",request.StartsOn);
                if(await cmd.ExecuteNonQueryAsync(ct)==0)return Results.NotFound();
                return Results.Ok(await LoadCircle(db,id,CanReadFinance(principal),ct));
            }
            catch(PostgresException ex) when(ex.SqlState=="23505"){return Results.Conflict(new{message="كود الحلقة مستخدم بالفعل."});}
            catch(PostgresException ex) when(ex.SqlState=="23503"){return Results.ValidationProblem(new Dictionary<string,string[]>{{"teacherId",["المعلمة المختارة غير موجودة."]}});}
            catch(PostgresException ex) when(ex.SqlState=="23514" && ex.ConstraintName=="ck_teacher_schedule_no_overlap")
            { return Results.Conflict(new { message = "لا يمكن إسناد هذه المعلمة للحلقة أو تفعيلها؛ لديها حصة أخرى تتداخل مع أحد مواعيد الحلقة. عدّل المواعيد أولًا." }); }
        }).RequireAuthorization("circles.edit");

        route.MapDelete("/{id:guid}",async Task<IResult> (Guid id,NpgsqlDataSource db,CancellationToken ct)=>
        {
            await using var cmd=db.CreateCommand("DELETE FROM circles WHERE id=@id AND NOT EXISTS(SELECT 1 FROM circle_enrollments WHERE circle_id=@id) RETURNING id;");cmd.Parameters.AddWithValue("id",id);
            try
            {
                if (await cmd.ExecuteScalarAsync(ct) is null) return Results.Conflict(new { message = "لا يمكن حذف الحلقة إذا لم تكن موجودة أو كان لها سجل التحاقات تاريخي. عطّلها بدل حذف سجلها." });
                return Results.Ok(new { id, deleted = true });
            }
            catch(PostgresException ex) when(ex.SqlState=="23503"){return Results.Conflict(new{message="الحلقة مرتبطة بسجلات مالية ولا يمكن حذفها نهائيًا."});}
        }).RequireAuthorization("circles.delete");
    }
}
