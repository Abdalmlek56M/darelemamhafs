using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

using Dar.Common.Pagination;
using DarEltahfeez.Api.Scoping;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private static void MapCollections(WebApplication app)
    {
        app.MapGet("/api/finance-entry-options", async Task<IResult> (string? month, int? page, int? pageSize, HttpContext http, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!TryMonth(month, out var billingMonth))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
            var paging = new PageRequest(page, pageSize);
            var paged = page is not null || pageSize is not null;

            var enrollments = new List<object>();
            long enrollmentsTotal = 0;
            var enrollmentQuery = """
                SELECT ce.id,s.id,s.student_code,s.full_name,c.id,c.name,COALESCE(t.full_name,''),COUNT(*) OVER() AS total
                FROM circle_enrollments ce
                JOIN students s ON s.id=ce.student_id
                JOIN circles c ON c.id=ce.circle_id
                LEFT JOIN teachers t ON t.id=c.teacher_id
                WHERE ce.is_trashed=FALSE AND s.is_trashed=FALSE AND c.is_trashed=FALSE
                  AND ce.starts_on<=(@month+INTERVAL '1 month - 1 day')::date
                  AND (ce.ends_on IS NULL OR ce.ends_on>=@month)
                  AND public.dar_enrollment_has_active_day_in_month(ce.id,@month)
                  AND NOT EXISTS(SELECT 1 FROM monthly_charges existing_charge WHERE existing_charge.enrollment_id=ce.id AND existing_charge.billing_month=@month AND existing_charge.is_trashed=FALSE AND existing_charge.voided_at IS NULL)
                ORDER BY c.name,s.full_name,ce.id
                """;
            if (paged) enrollmentQuery += " LIMIT @take OFFSET @skip";
            await using (var cmd = db.CreateCommand(enrollmentQuery))
            {
                cmd.Parameters.AddWithValue("month", billingMonth);
                if (paged)
                {
                    cmd.Parameters.AddWithValue("take", paging.PageSize);
                    cmd.Parameters.AddWithValue("skip", paging.Offset);
                }
                await using var reader = await cmd.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    enrollmentsTotal = reader.ReadTotal();
                    enrollments.Add(new { enrollmentId=reader.GetGuid(0), studentId=reader.GetGuid(1), studentCode=reader.GetString(2), studentName=reader.GetString(3), circleId=reader.GetGuid(4), circleName=reader.GetString(5), teacherName=reader.GetString(6) });
                }
                await reader.DisposeAsync();
                enrollmentsTotal = await PaginationRules.EnsureTotalAsync(cmd, enrollmentsTotal, paged, ct);
            }

            var charges = new List<object>();
            long chargesTotal = 0;
            var chargeQuery = """
                SELECT mc.id,s.student_code,s.full_name,c.name,mc.billing_month,COUNT(*) OVER() AS total
                FROM monthly_charges mc
                JOIN circle_enrollments ce ON ce.id=mc.enrollment_id
                JOIN students s ON s.id=ce.student_id
                JOIN circles c ON c.id=ce.circle_id
                WHERE mc.billing_month=@month AND mc.is_trashed=FALSE AND mc.voided_at IS NULL AND ce.is_trashed=FALSE
                  AND s.is_trashed=FALSE AND c.is_trashed=FALSE
                ORDER BY c.name,s.full_name,mc.id
                """;
            if (paged) chargeQuery += " LIMIT @take OFFSET @skip";
            await using (var cmd = db.CreateCommand(chargeQuery))
            {
                cmd.Parameters.AddWithValue("month", billingMonth);
                if (paged)
                {
                    cmd.Parameters.AddWithValue("take", paging.PageSize);
                    cmd.Parameters.AddWithValue("skip", paging.Offset);
                }
                await using var reader = await cmd.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    chargesTotal = reader.ReadTotal();
                    charges.Add(new { monthlyChargeId=reader.GetGuid(0), studentCode=reader.GetString(1), studentName=reader.GetString(2), circleName=reader.GetString(3), billingMonth=reader.GetFieldValue<DateOnly>(4) });
                }
                await reader.DisposeAsync();
                chargesTotal = await PaginationRules.EnsureTotalAsync(cmd, chargesTotal, paged, ct);
            }

            PaginationHeaderWriter.Write(http.Response, enrollmentsTotal, paging, enrollments.Count, paged);
            // This endpoint intentionally returns identity and opaque record IDs only; no fees, payments, balances or payment status.
            return Results.Ok(new { billingMonth, enrollments, charges, enrollmentsTotal, chargesTotal });
        }).RequireAuthorization("finance.create");

        app.MapGet("/api/collections",async Task<IResult> (string? month,int? page,int? pageSize,HttpContext http,NpgsqlDataSource db,CancellationToken ct)=>
        {
            if(!TryMonth(month,out var billingMonth))return Results.ValidationProblem(new Dictionary<string,string[]>{{"month",["حدد الشهر بصيغة YYYY-MM."]}});
            var paging=new PageRequest(page,pageSize);var paged=page is not null||pageSize is not null;
            var (rows,total)=await LoadCollections(db,billingMonth,ct,paged?paging:null);
            PaginationHeaderWriter.Write(http.Response,total,paging,rows.Length,paged);
            return Results.Ok(rows);
        }).RequireAuthorization("finance.read");

        app.MapPost("/api/charges", (ChargeWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, HttpRequest httpRequest, CancellationToken ct) =>
            CreateChargeWithIdempotencyAsync(request, principal, db, httpRequest, ct)).RequireAuthorization("finance.create").AddEndpointFilter<ScopedAccessEndpointFilter>();


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
                await AuditLogWriter.WriteAsync(conn, tx, ActorId(principal), null, "charge.update", "monthly_charge", id,
                    detailsJson: JsonSerializer.Serialize(new { amountDue, amountPaid = paid }),
                    cancellationToken: ct);
                await tx.CommitAsync(ct);
                return Results.Ok(response);
            }
        }).RequireAuthorization("finance.edit", "finance.read").AddEndpointFilter<ScopedAccessEndpointFilter>();

        app.MapPost("/api/payments", (PaymentWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, HttpRequest httpRequest, CancellationToken ct) =>
            CreatePaymentWithIdempotencyAsync(request, principal, db, httpRequest, ct)).RequireAuthorization("finance.create").AddEndpointFilter<ScopedAccessEndpointFilter>();

        app.MapPost("/api/payments/with-receipt", async Task<IResult> (HttpRequest httpRequest, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!httpRequest.HasFormContentType) return Results.BadRequest(new { message = "ارفع الإيصال مع بيانات التحصيل في نموذج متعدد الأجزاء." });
            var form = await httpRequest.ReadFormAsync(ct);
            if (!Guid.TryParse(form["monthlyChargeId"], out var chargeId) || chargeId == Guid.Empty)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["payment"] = ["حدد الاستحقاق ومبلغًا صحيحًا أكبر من صفر وبحد أقصى 9,999,999,999.99 ج.م."] });
            var denied = await ScopedWriteGuard.RequireEntityAsync(db, principal, "monthly-charge", chargeId, ct);
            if (denied is not null) return denied;
            var idempotencyKey = IdempotencySupport.ReadKey(httpRequest);
            if (idempotencyKey is not null)
            {
                await using var replayConnection = await db.OpenConnectionAsync(ct);
                var existing = await IdempotencySupport.FindPaymentAsync(replayConnection, null, idempotencyKey, ct);
                if (existing is not null) return PaymentReplayResult(existing, principal);
            }
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
            // P0-2: receipt uploads also use the server clock, never the browser's paidAt field.
            DateTimeOffset paidAt = DateTimeOffset.UtcNow;
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
            await using (var insert = new NpgsqlCommand("INSERT INTO payments(id,monthly_charge_id,amount,paid_at,method,reference,note,recorded_by,receipt_file_name,receipt_content_type,receipt_data,receipt_uploaded_at,client_key) VALUES(@id,@charge,@amount,@date,@method,@reference,@note,@actor,@filename,@contenttype,@data,now(),@key);", conn, tx))
            {
                insert.Parameters.AddWithValue("id",paymentId);insert.Parameters.AddWithValue("charge",chargeId);insert.Parameters.AddWithValue("amount",amount);insert.Parameters.AddWithValue("date",paidAt);
                AddNullable(insert,"method",method);AddNullable(insert,"reference",reference);AddNullable(insert,"note",note);insert.Parameters.AddWithValue("actor",ActorId(principal));
                insert.Parameters.AddWithValue("filename",Path.GetFileName(receipt.FileName));insert.Parameters.AddWithValue("contenttype",contentType);insert.Parameters.AddWithValue("data",bytes);
                AddNullable(insert,"key",idempotencyKey);
                try { await insert.ExecuteNonQueryAsync(ct); }
                catch (PostgresException ex) when (ex.SqlState == "23505" && idempotencyKey is not null)
                {
                    await tx.RollbackAsync(ct);
                    await using var replayConnection = await db.OpenConnectionAsync(ct);
                    var existing = await IdempotencySupport.FindPaymentAsync(replayConnection, null, idempotencyKey, ct);
                    return existing is null
                        ? Results.Conflict(new { message = "تم تسجيل حركة التحصيل بالفعل." })
                        : PaymentReplayResult(existing, principal);
                }
            }
            await AuditLogWriter.WriteAsync(conn, tx, ActorId(principal), null, "payment.create_with_receipt", "payment", paymentId,
                detailsJson: JsonSerializer.Serialize(new { chargeId, amount, receiptFileName = Path.GetFileName(receipt.FileName) }),
                cancellationToken: ct);
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
            await AuditLogWriter.WriteAsync(conn, tx, actor, null, "charge.void", "monthly_charge", id,
                detailsJson: JsonSerializer.Serialize(new { amountDue, voidReason = voidReason ?? request.Reason }),
                cancellationToken: ct);
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
            await AuditLogWriter.WriteAsync(conn, tx, actor, null, "payment.void", "payment", id,
                detailsJson: JsonSerializer.Serialize(new { chargeId, amount, voidReason = voidReason ?? request.Reason }),
                cancellationToken: ct);
            await tx.CommitAsync(ct);
            return Results.Ok(new { id, monthlyChargeId = chargeId, voidedAt, voidReason });
        }).RequireAuthorization("finance.void").AddEndpointFilter<ScopedAccessEndpointFilter>();

    }
    private static async Task<(CollectionRow[] Rows,long Total)> LoadCollections(NpgsqlDataSource db,DateOnly month,CancellationToken ct,PageRequest? paging=null)
    {
        var rows=new List<CollectionRow>();
        var query="""
          SELECT ce.id,mc.id,s.id,s.student_code,s.full_name,c.id,c.name,COALESCE(t.full_name,''),ce.agreed_monthly_fee,
                 COALESCE(mc.amount_due,0),COALESCE(p.paid,0),mc.note,
                 CASE WHEN mc.id IS NULL THEN 'not-set' WHEN COALESCE(p.paid,0)>=mc.amount_due THEN 'paid' WHEN COALESCE(p.paid,0)>0 THEN 'partial' ELSE 'unpaid' END,
                 ce.starts_on,ce.ends_on,c.starts_on,COUNT(*) OVER() AS total
          FROM circle_enrollments ce JOIN students s ON s.id=ce.student_id JOIN circles c ON c.id=ce.circle_id LEFT JOIN teachers t ON t.id=c.teacher_id
          LEFT JOIN monthly_charges mc ON mc.enrollment_id=ce.id AND mc.billing_month=@month AND mc.is_trashed=FALSE AND mc.voided_at IS NULL
          LEFT JOIN LATERAL(SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE monthly_charge_id=mc.id AND is_trashed=FALSE AND voided_at IS NULL) p ON TRUE
          WHERE ce.is_trashed=FALSE AND s.is_trashed=FALSE AND c.is_trashed=FALSE AND (ce.status='active' OR mc.id IS NOT NULL) AND ce.starts_on<=(@month+INTERVAL '1 month - 1 day')::date AND (ce.ends_on IS NULL OR ce.ends_on>=@month) AND (c.starts_on<=(@month+INTERVAL '1 month - 1 day')::date OR mc.id IS NOT NULL)
          ORDER BY c.name,s.full_name,ce.id
          """;
        if(paging is not null)query+=" LIMIT @take OFFSET @skip";
        await using var cmd=db.CreateCommand(query);cmd.Parameters.AddWithValue("month",month);
        if(paging is not null){cmd.Parameters.AddWithValue("take",paging.Value.PageSize);cmd.Parameters.AddWithValue("skip",paging.Value.Offset);}
        long total=0;await using var reader=await cmd.ExecuteReaderAsync(ct);
        while(await reader.ReadAsync(ct)){total=reader.ReadTotal();rows.Add(new CollectionRow(reader.GetGuid(0),reader.IsDBNull(1)?null:reader.GetGuid(1),reader.GetGuid(2),reader.GetString(3),reader.GetString(4),reader.GetGuid(5),reader.GetString(6),reader.GetString(7),reader.GetDecimal(8),reader.GetDecimal(9),reader.GetDecimal(10),reader.IsDBNull(11)?null:reader.GetString(11),reader.GetString(12),month,reader.GetFieldValue<DateOnly>(13),reader.IsDBNull(14)?null:reader.GetFieldValue<DateOnly>(14),reader.GetFieldValue<DateOnly>(15)));}
        return (rows.ToArray(),total);
    }
}