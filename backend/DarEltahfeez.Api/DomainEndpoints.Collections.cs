using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

using DarEltahfeez.Api.Scoping;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private static void MapCollections(WebApplication app)
    {
        app.MapGet("/api/finance-entry-options", async Task<IResult> (string? month, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!TryMonth(month, out var billingMonth))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });

            var enrollments = new List<object>();
            await using (var cmd = db.CreateCommand("""
                SELECT ce.id,s.id,s.student_code,s.full_name,c.id,c.name,COALESCE(t.full_name,'')
                FROM circle_enrollments ce
                JOIN students s ON s.id=ce.student_id
                JOIN circles c ON c.id=ce.circle_id
                LEFT JOIN teachers t ON t.id=c.teacher_id
                WHERE ce.is_trashed=FALSE AND s.is_trashed=FALSE AND c.is_trashed=FALSE
                  AND ce.starts_on<=(@month+INTERVAL '1 month - 1 day')::date
                  AND (ce.ends_on IS NULL OR ce.ends_on>=@month)
                  AND public.dar_enrollment_has_active_day_in_month(ce.id,@month)
                  AND NOT EXISTS(SELECT 1 FROM monthly_charges existing_charge WHERE existing_charge.enrollment_id=ce.id AND existing_charge.billing_month=@month AND existing_charge.is_trashed=FALSE AND existing_charge.voided_at IS NULL)
                ORDER BY c.name,s.full_name;
                """))
            {
                cmd.Parameters.AddWithValue("month", billingMonth);
                await using var reader = await cmd.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct)) enrollments.Add(new { enrollmentId=reader.GetGuid(0), studentId=reader.GetGuid(1), studentCode=reader.GetString(2), studentName=reader.GetString(3), circleId=reader.GetGuid(4), circleName=reader.GetString(5), teacherName=reader.GetString(6) });
            }

            var charges = new List<object>();
            await using (var cmd = db.CreateCommand("""
                SELECT mc.id,s.student_code,s.full_name,c.name,mc.billing_month
                FROM monthly_charges mc
                JOIN circle_enrollments ce ON ce.id=mc.enrollment_id
                JOIN students s ON s.id=ce.student_id
                JOIN circles c ON c.id=ce.circle_id
                WHERE mc.billing_month=@month AND mc.is_trashed=FALSE AND mc.voided_at IS NULL AND ce.is_trashed=FALSE
                  AND s.is_trashed=FALSE AND c.is_trashed=FALSE
                ORDER BY c.name,s.full_name;
                """))
            {
                cmd.Parameters.AddWithValue("month", billingMonth);
                await using var reader = await cmd.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct)) charges.Add(new { monthlyChargeId=reader.GetGuid(0), studentCode=reader.GetString(1), studentName=reader.GetString(2), circleName=reader.GetString(3), billingMonth=reader.GetFieldValue<DateOnly>(4) });
            }

            // This endpoint intentionally returns identity and opaque record IDs only; no fees, payments, balances or payment status.
            return Results.Ok(new { billingMonth, enrollments, charges });
        }).RequireAuthorization("finance.create");

        app.MapGet("/api/collections",async Task<IResult> (string? month,NpgsqlDataSource db,CancellationToken ct)=>
        {
            if(!TryMonth(month,out var billingMonth))return Results.ValidationProblem(new Dictionary<string,string[]>{{"month",["حدد الشهر بصيغة YYYY-MM."]}});
            return Results.Ok(await LoadCollections(db,billingMonth,ct));
        }).RequireAuthorization("finance.read");

        app.MapPost("/api/charges",async Task<IResult> (ChargeWriteRequest request,ClaimsPrincipal principal,NpgsqlDataSource db,CancellationToken ct)=>
        {
            if(request.EnrollmentId==Guid.Empty||!TryMonth(request.BillingMonth,out var month))
                return Results.ValidationProblem(new Dictionary<string,string[]>{{"charge",["حدد الالتحاق والشهر الصحيح."]}});
            if (!MoneyRules.TryNormalizeNonNegativeCurrency(request.AmountDue, out var amountDue))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["amountDue"] = ["المبلغ يتجاوز الحد المسموح أو لا يمكن تمثيله بدقة منزلتين عشريتين."] });
            try
            {
                await using var cmd=db.CreateCommand("""
                    INSERT INTO monthly_charges(enrollment_id,billing_month,amount_due,note)
                    SELECT ce.id,@month,@amount,@note
                    FROM circle_enrollments ce
                    JOIN students s ON s.id=ce.student_id
                    JOIN circles c ON c.id=ce.circle_id
                    WHERE ce.id=@enrollment AND ce.is_trashed=FALSE
                      AND s.is_trashed=FALSE AND c.is_trashed=FALSE
                      AND ce.starts_on<=(@month+INTERVAL '1 month - 1 day')::date
                      AND (ce.ends_on IS NULL OR ce.ends_on>=@month)
                      AND public.dar_enrollment_has_active_day_in_month(ce.id,@month)
                    RETURNING id;
                    """);
                cmd.Parameters.AddWithValue("enrollment",request.EnrollmentId);cmd.Parameters.AddWithValue("month",month);cmd.Parameters.AddWithValue("amount",amountDue);AddNullable(cmd,"note",request.Note);
                var chargeValue = await cmd.ExecuteScalarAsync(ct);
                if (chargeValue is null) return Results.NotFound(new { message = "سجل الالتحاق غير موجود أو موجود في سلة المهملات." });
                var id=(Guid)chargeValue;
                return Results.Created($"/api/charges/{id}",new{id,enrollmentId=request.EnrollmentId,billingMonth=month,amountDue=CanReadFinance(principal) ? amountDue : (decimal?)null,note=request.Note});
            }
            catch(PostgresException ex) when(ex.SqlState=="23505"){return Results.Conflict(new{message="تم تحديد الاستحقاق لهذا الطالب والحلقة في الشهر نفسه بالفعل."});}
            catch(PostgresException ex) when(ex.SqlState=="23503"){return Results.NotFound(new{message="سجل الالتحاق غير موجود."});}
        }).RequireAuthorization("finance.create").AddEndpointFilter<ScopedAccessEndpointFilter>();


        app.MapPut("/api/charges/{id:guid}", async Task<IResult> (Guid id, ChargeUpdateRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!MoneyRules.TryNormalizeNonNegativeCurrency(request.AmountDue, out var amountDue))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["amountDue"] = ["المبلغ يتجاوز الحد المسموح أو لا يمكن تمثيله بدقة منزلتين عشريتين."] });
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            decimal paid;
            await using (var check = new NpgsqlCommand("SELECT id FROM monthly_charges WHERE id=@id AND is_trashed=FALSE AND voided_at IS NULL FOR UPDATE;", conn, tx))
            {
                check.Parameters.AddWithValue("id", id);
                var value = await check.ExecuteScalarAsync(ct);
                if (value is null) return Results.NotFound(new { message = "الاستحقاق غير موجود." });
            }
            await using (var sum = new NpgsqlCommand("SELECT COALESCE(SUM(amount),0) FROM payments WHERE monthly_charge_id=@id AND is_trashed=FALSE AND voided_at IS NULL;", conn, tx))
            {
                sum.Parameters.AddWithValue("id", id);
                paid = Convert.ToDecimal(await sum.ExecuteScalarAsync(ct) ?? 0m, System.Globalization.CultureInfo.InvariantCulture);
            }
            if (amountDue < paid) return Results.Conflict(new { message = CanReadFinance(principal) ? $"لا يمكن أن يقل الاستحقاق عن المبلغ المحصل بالفعل ({paid:0.00} ج.م)." : "لا يمكن تخفيض الاستحقاق عن قيمة التحصيل المسجل." });
            await using (var update = new NpgsqlCommand("UPDATE monthly_charges SET amount_due=@amount,note=@note WHERE id=@id RETURNING id,amount_due,note;", conn, tx))
            {
                update.Parameters.AddWithValue("id", id); update.Parameters.AddWithValue("amount", amountDue); AddNullable(update, "note", request.Note);
                await using var reader = await update.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct)) return Results.NotFound();
                var response = new { id = reader.GetGuid(0), amountDue = CanReadFinance(principal) ? reader.GetDecimal(1) : (decimal?)null, note = reader.IsDBNull(2) ? null : reader.GetString(2) };
                await reader.CloseAsync();
                await using var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'charge.update','monthly_charge',@id,jsonb_build_object('amountDue',@amount,'amountPaid',@paid));", conn, tx);
                audit.Parameters.AddWithValue("actor", ActorId(principal)); audit.Parameters.AddWithValue("id", id); audit.Parameters.AddWithValue("amount", amountDue); audit.Parameters.AddWithValue("paid", paid);
                await audit.ExecuteNonQueryAsync(ct);
                await tx.CommitAsync(ct);
                return Results.Ok(response);
            }
        }).RequireAuthorization("finance.edit", "finance.read").AddEndpointFilter<ScopedAccessEndpointFilter>();

        app.MapPost("/api/payments",async Task<IResult> (PaymentWriteRequest request,ClaimsPrincipal principal,NpgsqlDataSource db,CancellationToken ct)=>
        {
            if (request.MonthlyChargeId == Guid.Empty)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["amount"] = ["حدد الاستحقاق واكتب مبلغًا صحيحًا أكبر من صفر وبحد أقصى 9,999,999,999.99 ج.م."] });
            if (!MoneyRules.TryNormalizePaymentAmount(request.Amount, out var paymentAmount))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["amount"] = ["حدد الاستحقاق واكتب مبلغًا صحيحًا أكبر من صفر وبحد أقصى 9,999,999,999.99 ج.م."] });
            await using var conn=await db.OpenConnectionAsync(ct);await using var tx=await conn.BeginTransactionAsync(ct);
            decimal due,paid;
            await using(var check=new NpgsqlCommand("SELECT amount_due FROM monthly_charges WHERE id=@id AND is_trashed=FALSE AND voided_at IS NULL FOR UPDATE;",conn,tx))
            {
                check.Parameters.AddWithValue("id",request.MonthlyChargeId);var value=await check.ExecuteScalarAsync(ct);
                if(value is null)return Results.NotFound(new{message="الاستحقاق غير موجود."});due=Convert.ToDecimal(value,System.Globalization.CultureInfo.InvariantCulture);
            }
            await using(var sum=new NpgsqlCommand("SELECT COALESCE(SUM(amount),0) FROM payments WHERE monthly_charge_id=@id AND is_trashed=FALSE AND voided_at IS NULL;",conn,tx))
            {sum.Parameters.AddWithValue("id",request.MonthlyChargeId);paid=Convert.ToDecimal(await sum.ExecuteScalarAsync(ct)??0m,System.Globalization.CultureInfo.InvariantCulture);}
            if (MoneyRules.ExceedsOutstanding(paymentAmount, due, paid))
                return Results.Conflict(new { message = CanReadFinance(principal) ? $"المبلغ أكبر من المتبقي ({MoneyRules.RoundCurrency(due - paid):0.00}). سجّل مبلغًا مساويًا أو أقل من المتبقي." : "المبلغ يتجاوز المتبقي المسموح لهذا الاستحقاق." });
            var paymentId=Guid.NewGuid();
            await using(var insert=new NpgsqlCommand("INSERT INTO payments(id,monthly_charge_id,amount,paid_at,method,reference,note,recorded_by) VALUES(@id,@charge,@amount,@date,@method,@reference,@note,@actor);",conn,tx))
            {
                insert.Parameters.AddWithValue("id",paymentId);insert.Parameters.AddWithValue("charge",request.MonthlyChargeId);insert.Parameters.AddWithValue("amount",paymentAmount);
                insert.Parameters.AddWithValue("date",request.PaidAt?.ToUniversalTime()??DateTimeOffset.UtcNow);AddNullable(insert,"method",request.Method);AddNullable(insert,"reference",request.Reference);AddNullable(insert,"note",request.Note);insert.Parameters.AddWithValue("actor",ActorId(principal));await insert.ExecuteNonQueryAsync(ct);
            }
            await tx.CommitAsync(ct);
            return Results.Created($"/api/payments/{paymentId}",new{id=paymentId,monthlyChargeId=request.MonthlyChargeId,amount=CanReadFinance(principal) ? paymentAmount : (decimal?)null,paidAt=request.PaidAt??DateTimeOffset.UtcNow,method=request.Method,reference=request.Reference,note=request.Note});
        }).RequireAuthorization("finance.create").AddEndpointFilter<ScopedAccessEndpointFilter>();

        app.MapPost("/api/payments/with-receipt", async Task<IResult> (HttpRequest httpRequest, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!httpRequest.HasFormContentType) return Results.BadRequest(new { message = "ارفع الإيصال مع بيانات التحصيل في نموذج متعدد الأجزاء." });
            var form = await httpRequest.ReadFormAsync(ct);
            if (!Guid.TryParse(form["monthlyChargeId"], out var chargeId) || chargeId == Guid.Empty)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["payment"] = ["حدد الاستحقاق ومبلغًا صحيحًا أكبر من صفر وبحد أقصى 9,999,999,999.99 ج.م."] });
            var denied = await ScopedWriteGuard.RequireEntityAsync(db, principal, "monthly-charge", chargeId, ct);
            if (denied is not null) return denied;
            if (!decimal.TryParse(form["amount"], System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var parsedAmount))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["payment"] = ["حدد الاستحقاق ومبلغًا صحيحًا أكبر من صفر وبحد أقصى 9,999,999,999.99 ج.م."] });
            if (!MoneyRules.TryNormalizePaymentAmount(parsedAmount, out var amount))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["payment"] = ["حدد الاستحقاق ومبلغًا صحيحًا أكبر من صفر وبحد أقصى 9,999,999,999.99 ج.م."] });
            var receipt = form.Files.GetFile("receipt");
            if (receipt is null || receipt.Length == 0) return Results.ValidationProblem(new Dictionary<string, string[]> { ["receipt"] = ["اختر صورة إيصال قبل الحفظ."] });
            if (receipt.Length > 8 * 1024 * 1024) return Results.ValidationProblem(new Dictionary<string, string[]> { ["receipt"] = ["حجم الصورة أكبر من 8 ميجابايت."] });
            var contentType = receipt.ContentType.ToLowerInvariant();
            if (!new[] { "image/jpeg", "image/png", "image/webp" }.Contains(contentType)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["receipt"] = ["الصيغ المسموحة هي JPG وPNG وWebP فقط."] });
            var bytes = new byte[checked((int)receipt.Length)]; await using (var stream = receipt.OpenReadStream()) { await stream.ReadExactlyAsync(bytes, ct); }
            var isJpeg = bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF;
            var isPng = bytes.Length >= 8 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47 && bytes[4] == 0x0D && bytes[5] == 0x0A && bytes[6] == 0x1A && bytes[7] == 0x0A;
            var isWebp = bytes.Length >= 12 && bytes[0] == (byte)'R' && bytes[1] == (byte)'I' && bytes[2] == (byte)'F' && bytes[3] == (byte)'F' && bytes[8] == (byte)'W' && bytes[9] == (byte)'E' && bytes[10] == (byte)'B' && bytes[11] == (byte)'P';
            if ((contentType == "image/jpeg" && !isJpeg) || (contentType == "image/png" && !isPng) || (contentType == "image/webp" && !isWebp))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["receipt"] = ["محتوى الملف لا يطابق صيغة الصورة المعلنة. اختر ملف صورة صحيحًا."] });
            DateTimeOffset paidAt = DateTimeOffset.UtcNow;
            if (DateTimeOffset.TryParse(form["paidAt"], System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.RoundtripKind, out var parsedDate)) paidAt = parsedDate.ToUniversalTime();
            string? method = form["method"].ToString(); string? reference = form["reference"].ToString(); string? note = form["note"].ToString();
            if (reference?.Length > 120 || note?.Length > 5000) return Results.ValidationProblem(new Dictionary<string, string[]> { ["note"] = ["المرجع أو الملاحظات أطول من المسموح."] });
            await using var conn = await db.OpenConnectionAsync(ct); await using var tx = await conn.BeginTransactionAsync(ct);
            decimal due;
            await using (var check = new NpgsqlCommand("SELECT amount_due FROM monthly_charges WHERE id=@id AND is_trashed=FALSE AND voided_at IS NULL FOR UPDATE;", conn, tx))
            { check.Parameters.AddWithValue("id", chargeId); var value = await check.ExecuteScalarAsync(ct); if (value is null) return Results.NotFound(new { message = "الاستحقاق غير موجود." }); due = Convert.ToDecimal(value, System.Globalization.CultureInfo.InvariantCulture); }
            decimal paid;
            await using (var sum = new NpgsqlCommand("SELECT COALESCE(SUM(amount),0) FROM payments WHERE monthly_charge_id=@id AND is_trashed=FALSE AND voided_at IS NULL;", conn, tx))
            { sum.Parameters.AddWithValue("id", chargeId); paid = Convert.ToDecimal(await sum.ExecuteScalarAsync(ct) ?? 0m, System.Globalization.CultureInfo.InvariantCulture); }
            if (MoneyRules.ExceedsOutstanding(amount, due, paid))
                return Results.Conflict(new { message = CanReadFinance(principal) ? $"المبلغ أكبر من المتبقي ({MoneyRules.RoundCurrency(due - paid):0.00}). سجّل مبلغًا مساويًا أو أقل من المتبقي." : "المبلغ يتجاوز المتبقي المسموح لهذا الاستحقاق." });
            var paymentId = Guid.NewGuid();
            await using (var insert = new NpgsqlCommand("INSERT INTO payments(id,monthly_charge_id,amount,paid_at,method,reference,note,recorded_by,receipt_file_name,receipt_content_type,receipt_data,receipt_uploaded_at) VALUES(@id,@charge,@amount,@date,@method,@reference,@note,@actor,@filename,@contenttype,@data,now());", conn, tx))
            {
                insert.Parameters.AddWithValue("id",paymentId);insert.Parameters.AddWithValue("charge",chargeId);insert.Parameters.AddWithValue("amount",amount);insert.Parameters.AddWithValue("date",paidAt);
                AddNullable(insert,"method",method);AddNullable(insert,"reference",reference);AddNullable(insert,"note",note);insert.Parameters.AddWithValue("actor",ActorId(principal));
                insert.Parameters.AddWithValue("filename",Path.GetFileName(receipt.FileName));insert.Parameters.AddWithValue("contenttype",contentType);insert.Parameters.AddWithValue("data",bytes);
                await insert.ExecuteNonQueryAsync(ct);
            }
            await using (var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'payment.create_with_receipt','payment',@id,jsonb_build_object('chargeId',@charge,'amount',@amount,'receiptFileName',@filename));",conn,tx))
            {audit.Parameters.AddWithValue("actor",ActorId(principal));audit.Parameters.AddWithValue("id",paymentId);audit.Parameters.AddWithValue("charge",chargeId);audit.Parameters.AddWithValue("amount",amount);audit.Parameters.AddWithValue("filename",Path.GetFileName(receipt.FileName));await audit.ExecuteNonQueryAsync(ct);}
            await tx.CommitAsync(ct);
            return Results.Created($"/api/payments/{paymentId}", new { id=paymentId, monthlyChargeId=chargeId, amount=CanReadFinance(principal) ? amount : (decimal?)null, paidAt, method, reference, note, hasReceipt=true });
        }).RequireAuthorization("finance.create").AddEndpointFilter<ScopedAccessEndpointFilter>();

        app.MapGet("/api/payments/{id:guid}/receipt", async Task<IResult> (Guid id, bool? download, NpgsqlDataSource db, HttpContext context, CancellationToken ct) =>
        {
            await using var cmd = db.CreateCommand("SELECT receipt_data,receipt_content_type,COALESCE(receipt_file_name,'receipt') FROM payments WHERE id=@id AND is_trashed=FALSE AND receipt_data IS NOT NULL;");
            cmd.Parameters.AddWithValue("id",id);await using var reader=await cmd.ExecuteReaderAsync(ct);
            if(!await reader.ReadAsync(ct))return Results.NotFound(new{message="لا يوجد إيصال محفوظ لحركة التحصيل."});
            var data=(byte[])reader[0];var contentType=reader.GetString(1);var fileName=Path.GetFileName(reader.GetString(2));
            context.Response.Headers["Content-Disposition"]=$"{(download==true?"attachment":"inline")}; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
            context.Response.Headers["Cache-Control"]="private, no-store";
            context.Response.Headers["X-Content-Type-Options"]="nosniff";
            return Results.File(data,contentType);
        }).RequireAuthorization("finance.read");

        app.MapPost("/api/charges/{id:guid}/void", async Task<IResult> (Guid id, VoidRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var actor = ActorId(principal);
            if (actor == Guid.Empty) return Results.Unauthorized();
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            int outcome;
            await using (var call = new NpgsqlCommand("SELECT public.dar_void_charge(@id,@actor,@reason);", conn, tx))
            {
                call.Parameters.AddWithValue("id", id);
                call.Parameters.AddWithValue("actor", actor);
                AddNullable(call, "reason", request.Reason);
                outcome = Convert.ToInt32(await call.ExecuteScalarAsync(ct) ?? 4, System.Globalization.CultureInfo.InvariantCulture);
            }
            if (outcome != 0)
            {
                await tx.RollbackAsync(ct);
                return outcome switch
                {
                    1 => Results.NotFound(new { message = "الاستحقاق غير موجود أو موجود في سلة المهملات." }),
                    2 => Results.Conflict(new { message = "الاستحقاق ملغي بالفعل." }),
                    3 => Results.Conflict(new { message = "لا يمكن إلغاء استحقاق عليه دفعات سارية — ألغِ الدفعات أولًا." }),
                    _ => Results.ValidationProblem(new Dictionary<string, string[]> { ["reason"] = ["سبب الإلغاء مطلوب وبين 3 و500 حرف."] })
                };
            }
            decimal amountDue; DateTimeOffset? voidedAt; string? voidReason;
            await using (var read = new NpgsqlCommand("SELECT amount_due,voided_at,void_reason FROM monthly_charges WHERE id=@id;", conn, tx))
            {
                read.Parameters.AddWithValue("id", id);
                await using var reader = await read.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct)) { await tx.RollbackAsync(ct); return Results.NotFound(new { message = "الاستحقاق غير موجود." }); }
                amountDue = reader.GetDecimal(0);
                voidedAt = reader.IsDBNull(1) ? null : reader.GetFieldValue<DateTimeOffset>(1);
                voidReason = reader.IsDBNull(2) ? null : reader.GetString(2);
                await reader.CloseAsync();
            }
            await using (var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'charge.void','monthly_charge',@id,jsonb_build_object('amountDue',@amount,'voidReason',@reason));", conn, tx))
            {
                audit.Parameters.AddWithValue("actor", actor);
                audit.Parameters.AddWithValue("id", id);
                audit.Parameters.AddWithValue("amount", amountDue);
                AddNullable(audit, "reason", voidReason ?? request.Reason);
                await audit.ExecuteNonQueryAsync(ct);
            }
            await tx.CommitAsync(ct);
            return Results.Ok(new { id, voidedAt, voidReason });
        }).RequireAuthorization("finance.void").AddEndpointFilter<ScopedAccessEndpointFilter>();

        app.MapPost("/api/payments/{id:guid}/void", async Task<IResult> (Guid id, VoidRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var actor = ActorId(principal);
            if (actor == Guid.Empty) return Results.Unauthorized();
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            int outcome;
            await using (var call = new NpgsqlCommand("SELECT public.dar_void_payment(@id,@actor,@reason);", conn, tx))
            {
                call.Parameters.AddWithValue("id", id);
                call.Parameters.AddWithValue("actor", actor);
                AddNullable(call, "reason", request.Reason);
                outcome = Convert.ToInt32(await call.ExecuteScalarAsync(ct) ?? 4, System.Globalization.CultureInfo.InvariantCulture);
            }
            if (outcome != 0)
            {
                await tx.RollbackAsync(ct);
                return outcome switch
                {
                    1 => Results.NotFound(new { message = "حركة التحصيل غير موجودة أو موجودة في سلة المهملات." }),
                    2 => Results.Conflict(new { message = "حركة التحصيل ملغاة بالفعل." }),
                    5 => Results.Conflict(new { message = "لا يمكن إلغاء الدفعة لأن فترة اشتراك الطالب انتهت أو الاشتراك غير نشط. لن يتغير أي سجل مالي." }),
                    _ => Results.ValidationProblem(new Dictionary<string, string[]> { ["reason"] = ["سبب الإلغاء مطلوب وبين 3 و500 حرف."] })
                };
            }
            Guid chargeId; decimal amount; DateTimeOffset? voidedAt; string? voidReason;
            await using (var read = new NpgsqlCommand("SELECT monthly_charge_id,amount,voided_at,void_reason FROM payments WHERE id=@id;", conn, tx))
            {
                read.Parameters.AddWithValue("id", id);
                await using var reader = await read.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct)) { await tx.RollbackAsync(ct); return Results.NotFound(new { message = "حركة التحصيل غير موجودة." }); }
                chargeId = reader.GetGuid(0);
                amount = reader.GetDecimal(1);
                voidedAt = reader.IsDBNull(2) ? null : reader.GetFieldValue<DateTimeOffset>(2);
                voidReason = reader.IsDBNull(3) ? null : reader.GetString(3);
                await reader.CloseAsync();
            }
            await using (var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'payment.void','payment',@id,jsonb_build_object('chargeId',@charge,'amount',@amount,'voidReason',@reason));", conn, tx))
            {
                audit.Parameters.AddWithValue("actor", actor);
                audit.Parameters.AddWithValue("id", id);
                audit.Parameters.AddWithValue("charge", chargeId);
                audit.Parameters.AddWithValue("amount", amount);
                AddNullable(audit, "reason", voidReason ?? request.Reason);
                await audit.ExecuteNonQueryAsync(ct);
            }
            await tx.CommitAsync(ct);
            return Results.Ok(new { id, monthlyChargeId = chargeId, voidedAt, voidReason });
        }).RequireAuthorization("finance.void").AddEndpointFilter<ScopedAccessEndpointFilter>();

    }
    private static async Task<CollectionRow[]> LoadCollections(NpgsqlDataSource db,DateOnly month,CancellationToken ct)
    {
        var rows=new List<CollectionRow>();
        await using var cmd=db.CreateCommand("""
          SELECT ce.id,mc.id,s.id,s.student_code,s.full_name,c.id,c.name,COALESCE(t.full_name,''),ce.agreed_monthly_fee,
                 COALESCE(mc.amount_due,0),COALESCE(p.paid,0),mc.note,
                 CASE WHEN mc.id IS NULL THEN 'not-set' WHEN COALESCE(p.paid,0)>=mc.amount_due THEN 'paid' WHEN COALESCE(p.paid,0)>0 THEN 'partial' ELSE 'unpaid' END,
                 ce.starts_on,ce.ends_on,c.starts_on
          FROM circle_enrollments ce JOIN students s ON s.id=ce.student_id JOIN circles c ON c.id=ce.circle_id LEFT JOIN teachers t ON t.id=c.teacher_id
          LEFT JOIN monthly_charges mc ON mc.enrollment_id=ce.id AND mc.billing_month=@month AND mc.is_trashed=FALSE AND mc.voided_at IS NULL
          LEFT JOIN LATERAL(SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE monthly_charge_id=mc.id AND is_trashed=FALSE AND voided_at IS NULL) p ON TRUE
          WHERE ce.is_trashed=FALSE AND s.is_trashed=FALSE AND c.is_trashed=FALSE AND (ce.status='active' OR mc.id IS NOT NULL) AND ce.starts_on<=(@month+INTERVAL '1 month - 1 day')::date AND (ce.ends_on IS NULL OR ce.ends_on>=@month) AND (c.starts_on<=(@month+INTERVAL '1 month - 1 day')::date OR mc.id IS NOT NULL)
          ORDER BY c.name,s.full_name;
          """);cmd.Parameters.AddWithValue("month",month);await using var reader=await cmd.ExecuteReaderAsync(ct);
        while(await reader.ReadAsync(ct))rows.Add(new CollectionRow(reader.GetGuid(0),reader.IsDBNull(1)?null:reader.GetGuid(1),reader.GetGuid(2),reader.GetString(3),reader.GetString(4),reader.GetGuid(5),reader.GetString(6),reader.GetString(7),reader.GetDecimal(8),reader.GetDecimal(9),reader.GetDecimal(10),reader.IsDBNull(11)?null:reader.GetString(11),reader.GetString(12),month,reader.GetFieldValue<DateOnly>(13),reader.IsDBNull(14)?null:reader.GetFieldValue<DateOnly>(14),reader.GetFieldValue<DateOnly>(15)));
        return rows.ToArray();
    }
}