using System.Security.Claims;
using System.Text.Json;
using DarEltahfeez.Api.Media;
using DarEltahfeez.Api.Scoping;
using Npgsql;

namespace DarEltahfeez.Api;

/// <summary>
/// FINAL Tier 2.5: receipt upload/download moved out of the hot payments.receipt_data BYTEA column.
/// New uploads write a content-addressed file and persist path/size/content-type only; legacy rows
/// are migrated lazily on first download. The response contract is unchanged (same bytes, content
/// type and Content-Disposition headers).
/// </summary>
public static partial class DomainEndpoints
{
    private static readonly string[] AllowedReceiptContentTypes =
        [MediaContentTypes.Jpeg, MediaContentTypes.Png, MediaContentTypes.WebP];

    private static void MapReceipts(WebApplication app)
    {
        app.MapPost("/api/payments/with-receipt", async Task<IResult> (
            HttpRequest httpRequest, ClaimsPrincipal principal, NpgsqlDataSource db,
            IMediaFileStore media, IReceiptImageProcessor receiptProcessor, CancellationToken ct) =>
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
            if (receipt.Length > MediaOptions.DefaultMaxReceiptBytes) return Results.ValidationProblem(new Dictionary<string, string[]> { ["receipt"] = ["حجم الصورة أكبر من 8 ميجابايت."] });
            var contentType = receipt.ContentType.ToLowerInvariant();
            if (!AllowedReceiptContentTypes.Contains(contentType)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["receipt"] = ["الصيغ المسموحة هي JPG وPNG وWebP فقط."] });
            var bytes = new byte[checked((int)receipt.Length)]; await using (var stream = receipt.OpenReadStream()) { await stream.ReadExactlyAsync(bytes, ct); }
            if (!MediaContentTypes.MatchesDeclared(bytes, contentType))
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

            // Receipt image hook: currently a documented pass-through because no cross-platform
            // image codec dependency exists in this offline-restore repository (see IReceiptImageProcessor).
            var processed = await receiptProcessor.ProcessAsync(bytes, contentType, ct);
            if (!MediaContentTypes.MatchesDeclared(processed.Content, processed.ContentType))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["receipt"] = ["محتوى الملف لا يطابق صيغة الصورة المعلنة. اختر ملف صورة صحيحًا."] });
            MediaFileWriteResult storedReceipt;
            try
            {
                storedReceipt = await media.SaveReceiptAsync(processed.Content, processed.ContentType, ct);
            }
            catch (MediaSizeLimitExceededException)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["receipt"] = ["حجم الصورة أكبر من 8 ميجابايت."] });
            }

            var paymentId = Guid.NewGuid();
            await using (var insert = new NpgsqlCommand("INSERT INTO payments(id,monthly_charge_id,amount,paid_at,method,reference,note,recorded_by,receipt_file_name,receipt_content_type,receipt_file_path,receipt_size_bytes,receipt_uploaded_at,client_key) VALUES(@id,@charge,@amount,@date,@method,@reference,@note,@actor,@filename,@contenttype,@path,@size,now(),@key);", conn, tx))
            {
                insert.Parameters.AddWithValue("id",paymentId);insert.Parameters.AddWithValue("charge",chargeId);insert.Parameters.AddWithValue("amount",amount);insert.Parameters.AddWithValue("date",paidAt);
                AddNullable(insert,"method",method);AddNullable(insert,"reference",reference);AddNullable(insert,"note",note);insert.Parameters.AddWithValue("actor",ActorId(principal));
                insert.Parameters.AddWithValue("filename",Path.GetFileName(receipt.FileName));insert.Parameters.AddWithValue("contenttype",storedReceipt.ContentType);
                insert.Parameters.AddWithValue("path",storedReceipt.RelativePath);insert.Parameters.AddWithValue("size",storedReceipt.SizeBytes);
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

        app.MapGet("/api/payments/{id:guid}/receipt", async Task<IResult> (
            Guid id, bool? download, NpgsqlDataSource db, IMediaFileStore media,
            MediaBackfillService backfill, HttpContext context, CancellationToken ct) =>
        {
            string? filePath, storedContentType;
            bool hasLegacyBytes;
            string fileName;
            await using (var cmd = db.CreateCommand("SELECT receipt_file_path,receipt_content_type,(receipt_data IS NOT NULL),COALESCE(receipt_file_name,'receipt') FROM payments WHERE id=@id AND is_trashed=FALSE AND (receipt_file_path IS NOT NULL OR receipt_data IS NOT NULL);"))
            {
                cmd.Parameters.AddWithValue("id", id);
                await using var reader = await cmd.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct)) return Results.NotFound(new { message = "لا يوجد إيصال محفوظ لحركة التحصيل." });
                filePath = reader.IsDBNull(0) ? null : reader.GetString(0);
                storedContentType = reader.IsDBNull(1) ? null : reader.GetString(1);
                hasLegacyBytes = reader.GetBoolean(2);
                fileName = Path.GetFileName(reader.GetString(3));
            }

            var data = filePath is null ? null : await media.ReadAsync(filePath, ct);
            if (data is null && hasLegacyBytes)
            {
                // Dual read / lazy migration: the first download of a legacy row writes the file
                // and records its path; if a path was recorded but the derived file disappeared,
                // it is re-materialised from the untouched BYTEA. Either way the original bytes
                // are served unchanged.
                var migrated = filePath is null
                    ? await backfill.MigrateReceiptAsync(id, ct)
                    : await backfill.RepairReceiptFileAsync(id, ct);
                if (migrated is not null) { data = migrated.Content; storedContentType ??= migrated.ContentType; }
            }
            if (data is null) return Results.NotFound(new { message = "لا يوجد إيصال محفوظ لحركة التحصيل." });

            var responseContentType = storedContentType ?? MediaContentTypes.OctetStream;
            context.Response.Headers["Content-Disposition"] = $"{(download == true ? "attachment" : "inline")}; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
            context.Response.Headers["Cache-Control"] = "private, no-store";
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            return Results.File(data, responseContentType);
        }).RequireAuthorization("finance.read");
    }
}
