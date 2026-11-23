using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private static void MapEnrollments(WebApplication app)
    {
        app.MapPost("/api/enrollments", async Task<IResult> (EnrollmentWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (request.StudentId == Guid.Empty || request.CircleId == Guid.Empty || request.StartsOn == default)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["enrollment"] = ["حدد الطالب والحلقة وتاريخ الالتحاق."] });
            var canReadFinance = CanReadFinance(principal);
            var canEditFinancials = CanEditFinancialValues(principal);
            if (!canEditFinancials && request.AgreedMonthlyFee is not null) return Results.Forbid();
            decimal? agreedMonthlyFee = null;
            if (canEditFinancials)
            {
                if (request.AgreedMonthlyFee is null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["agreedMonthlyFee"] = ["الرسوم المتفق عليها مطلوبة عند التعديل المالي."] });
                if (!MoneyRules.TryNormalizeNonNegativeCurrency(request.AgreedMonthlyFee.Value, out var normalizedFee))
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["agreedMonthlyFee"] = ["الرسوم المتفق عليها تتجاوز الحد المسموح أو لا يمكن تمثيلها بدقة منزلتين عشريتين."] });
                agreedMonthlyFee = normalizedFee;
            }
            if (request.AllowClosedCircle && !principal.HasClaim("permission", "circles.edit")) return Results.Forbid();
            try
            {
                await using var conn = await db.OpenConnectionAsync(ct);
                await using var tx = await conn.BeginTransactionAsync(ct);
                await using (var studentLock = new NpgsqlCommand("SELECT id FROM students WHERE id=@student AND is_trashed=FALSE AND status='active' FOR UPDATE;", conn, tx))
                {
                    studentLock.Parameters.AddWithValue("student", request.StudentId);
                    if (await studentLock.ExecuteScalarAsync(ct) is not Guid) return Results.Conflict(new { message = "لا يمكن إلحاق الطالب؛ تأكد أن ملفه نشط وغير موجود في سلة المهملات." });
                }
                await using (var duplicate = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM circle_enrollments WHERE student_id=@student AND circle_id=@circle AND is_trashed=FALSE AND status IN ('active','paused'));", conn, tx))
                {
                    duplicate.Parameters.AddWithValue("student", request.StudentId); duplicate.Parameters.AddWithValue("circle", request.CircleId);
                    if ((bool)(await duplicate.ExecuteScalarAsync(ct) ?? false)) return Results.Conflict(new { message = "الطالب لديه بالفعل التحاق نشط أو متوقف مؤقتًا بهذه الحلقة. استأنف الالتحاق الحالي أو أنهِه قبل إنشاء التحاق جديد." });
                }
                await using var cmd = new NpgsqlCommand("INSERT INTO circle_enrollments(student_id,circle_id,starts_on,agreed_monthly_fee,status) SELECT s.id,c.id,@starts,COALESCE(@fee,c.monthly_fee),'active' FROM students s CROSS JOIN circles c WHERE s.id=@student AND s.is_trashed=FALSE AND s.status='active' AND c.id=@circle AND c.is_trashed=FALSE AND (c.is_active=TRUE OR @allowClosed=TRUE) RETURNING id;", conn, tx);
                cmd.Parameters.AddWithValue("student", request.StudentId);
                cmd.Parameters.AddWithValue("circle", request.CircleId);
                cmd.Parameters.AddWithValue("starts", request.StartsOn);
                cmd.Parameters.AddWithValue("fee", agreedMonthlyFee.HasValue ? (object)agreedMonthlyFee.Value : DBNull.Value);
                cmd.Parameters.AddWithValue("allowClosed", request.AllowClosedCircle);
                var enrollmentValue = await cmd.ExecuteScalarAsync(ct);
                if (enrollmentValue is null) return Results.Conflict(new { message = "تعذر الإلحاق: تأكد أن الطالب نشط وأن الحلقة نشطة وغير موجودة في سلة المهملات." });
                var id = (Guid)enrollmentValue;
                await InsertEnrollmentStatusEventAsync(conn, tx, id, "enrollment.status.baseline", "active", request.StartsOn, "بداية الالتحاق.", ActorId(principal), ct);
                await tx.CommitAsync(ct);
                return Results.Created($"/api/enrollments/{id}", new { id, request.StudentId, request.CircleId, request.StartsOn, agreedMonthlyFee = canReadFinance ? agreedMonthlyFee : null, status = "active" });
            }
            catch (PostgresException ex) when (ex.SqlState == "23503") { return Results.ValidationProblem(new Dictionary<string, string[]> { ["studentOrCircle"] = ["الطالب أو الحلقة غير موجودة."] }); }
            catch (PostgresException ex) when (ex.SqlState == "23505") { return Results.Conflict(new { message = "الطالب ملتحق بالفعل بهذه الحلقة. أنهِ الالتحاق السابق أولًا إذا كان المقصود تسجيل التحاق جديد." }); }
        }).RequireAuthorization("students.edit");

        app.MapPost("/api/circle-enrollments/bulk", async Task<IResult> (BulkEnrollmentWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (request.CircleId == Guid.Empty)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["enrollment"] = ["اختر الحلقة."] });
            if (request.StartsOn == default)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["startsOn"] = ["حدد تاريخ بداية الالتحاق."] });
            if (request.AllowClosedCircle && !principal.HasClaim("permission", "circles.edit")) return Results.Forbid();

            // The explicit per-student list wins; the legacy studentIds payload keeps working
            // and falls back to the circle monthly fee (previous behaviour).
            var canEditFinancials = CanEditFinancialValues(principal);
            var requested = (request.Students is { Count: > 0 }
                    ? request.Students
                        .Where(item => item.StudentId != Guid.Empty)
                        .GroupBy(item => item.StudentId)
                        .Select(group => group.First())
                    : (request.StudentIds ?? []).Where(value => value != Guid.Empty).Distinct().Select(value => new BulkEnrollmentStudent(value, null)))
                .Take(200)
                .ToArray();
            if (requested.Length == 0)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["students"] = ["اختر طالبة واحدة على الأقل."] });

            var fees = new decimal?[requested.Length];
            for (var index = 0; index < requested.Length; index++)
            {
                if (requested[index].AgreedMonthlyFee is not { } fee) continue;
                if (!canEditFinancials) return Results.Forbid();
                if (!MoneyRules.TryNormalizeNonNegativeCurrency(fee, out var normalizedFee))
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["agreedMonthlyFee"] = ["رسوم أحد الطلاب غير صالحة (رقم غير سالب بمنزلتين عشريتين على الأكثر)."] });
                fees[index] = normalizedFee;
            }
            var studentIds = requested.Select(item => item.StudentId).ToArray();

            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            bool circleActive;
            await using (var circle = new NpgsqlCommand("SELECT is_active FROM circles WHERE id=@circle AND is_trashed=FALSE;", conn, tx))
            {
                circle.Parameters.AddWithValue("circle", request.CircleId);
                var value = await circle.ExecuteScalarAsync(ct);
                if (value is null) return Results.NotFound(new { message = "الحلقة غير موجودة." });
                circleActive = (bool)value;
            }
            if (!circleActive && !request.AllowClosedCircle)
                return Results.Conflict(new { message = "الحلقة متوقفة. فعّلها أولًا أو استخدم خيار السماح بالحلقة المتوقفة." });

            var added = new List<(Guid EnrollmentId, Guid StudentId)>();
            await using (var insert = new NpgsqlCommand("""
                INSERT INTO circle_enrollments(student_id,circle_id,starts_on,agreed_monthly_fee,status)
                SELECT s.id,c.id,@starts,COALESCE(rec.fee,c.monthly_fee),'active'
                FROM jsonb_to_recordset(@students::jsonb) AS rec(student_id uuid, fee numeric)
                JOIN students s ON s.id=rec.student_id AND s.is_trashed=FALSE AND s.status='active'
                CROSS JOIN circles c
                WHERE c.id=@circle AND c.is_trashed=FALSE
                  AND NOT EXISTS (
                      SELECT 1 FROM circle_enrollments existing
                      WHERE existing.student_id=s.id AND existing.circle_id=c.id
                        AND existing.is_trashed=FALSE AND existing.status IN ('active','paused'))
                ON CONFLICT (student_id,circle_id) WHERE status='active' DO NOTHING
                RETURNING id,student_id;
                """, conn, tx))
            {
                var studentsJson = JsonSerializer.Serialize(requested.Select((item, index) => new { student_id = item.StudentId, fee = fees[index] }));
                insert.Parameters.AddWithValue("students", studentsJson);
                insert.Parameters.AddWithValue("circle", request.CircleId);
                insert.Parameters.AddWithValue("starts", request.StartsOn);
                await using var reader = await insert.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct)) added.Add((reader.GetGuid(0), reader.GetGuid(1)));
            }

            foreach (var (enrollmentId, _) in added)
                await InsertEnrollmentStatusEventAsync(conn, tx, enrollmentId, "enrollment.status.baseline", "active", request.StartsOn, "بداية الالتحاق الجماعي.", ActorId(principal), ct);

            var feesApplied = fees.Count(value => value.HasValue);
            await using (var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'enrollment.bulk_create','circle',@circle,jsonb_build_object('requested',@requested,'added',@added,'startsOn',@starts,'feesSet',@feesSet));", conn, tx))
            {
                audit.Parameters.AddWithValue("actor", ActorId(principal));
                audit.Parameters.AddWithValue("circle", request.CircleId);
                audit.Parameters.AddWithValue("requested", studentIds.Length);
                audit.Parameters.AddWithValue("added", added.Count);
                audit.Parameters.AddWithValue("starts", request.StartsOn);
                audit.Parameters.AddWithValue("feesSet", feesApplied);
                await audit.ExecuteNonQueryAsync(ct);
            }
            await tx.CommitAsync(ct);
            return Results.Ok(new { added = added.Count, skipped = studentIds.Length - added.Count, feesApplied });
        }).RequireAuthorization("students.edit");

        app.MapPatch("/api/enrollments/{id:guid}/pause", async Task<IResult> (Guid id, EnrollmentStatusChangeRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (request.Reason?.Length > 500) return Results.ValidationProblem(new Dictionary<string, string[]> { ["reason"] = ["سبب الإيقاف يجب ألا يتجاوز 500 حرف."] });
            var effectiveOn = request.EffectiveOn ?? DateOnly.FromDateTime(DateTime.Today);
            if (effectiveOn > DateOnly.FromDateTime(DateTime.Today)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["effectiveOn"] = ["تاريخ الإيقاف لا يمكن أن يكون في المستقبل."] });
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            await using var get = new NpgsqlCommand("SELECT starts_on,ends_on,status FROM circle_enrollments WHERE id=@id AND is_trashed=FALSE FOR UPDATE;", conn, tx);
            get.Parameters.AddWithValue("id", id);
            await using var reader = await get.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return Results.NotFound();
            var startsOn = reader.GetFieldValue<DateOnly>(0);
            var endsOn = reader.IsDBNull(1) ? (DateOnly?)null : reader.GetFieldValue<DateOnly>(1);
            var currentStatus = reader.GetString(2);
            await reader.DisposeAsync();
            if (currentStatus != "active") return Results.Conflict(new { message = "لا يمكن إيقاف هذا الالتحاق؛ يجب أن تكون حالته نشطة." });
            if (effectiveOn < startsOn || (endsOn.HasValue && effectiveOn > endsOn.Value)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["effectiveOn"] = ["تاريخ الإيقاف يجب أن يقع داخل فترة الالتحاق."] });
            await EnsureEnrollmentStatusBaselineAsync(conn, tx, id, startsOn, currentStatus, ActorId(principal), ct);
            var latestStatusDate = await GetLatestEnrollmentStatusDateAsync(conn, tx, id, ct);
            if (latestStatusDate.HasValue && effectiveOn < latestStatusDate.Value) return Results.ValidationProblem(new Dictionary<string, string[]> { ["effectiveOn"] = ["لا يمكن تسجيل تغيير حالة بتاريخ يسبق آخر تغيير مسجل. استخدم تاريخًا مساويًا أو أحدث."] });
            await using (var update = new NpgsqlCommand("UPDATE circle_enrollments SET status='paused' WHERE id=@id AND status='active';", conn, tx))
            { update.Parameters.AddWithValue("id", id); if (await update.ExecuteNonQueryAsync(ct) != 1) return Results.Conflict(new { message = "تغيرت حالة الالتحاق أثناء العملية. حدّث البيانات ثم أعد المحاولة." }); }
            await InsertEnrollmentStatusEventAsync(conn, tx, id, "enrollment.pause", "paused", effectiveOn, request.Reason, ActorId(principal), ct);
            await tx.CommitAsync(ct);
            return Results.Ok(new { id, status = "paused", effectiveOn });
        }).RequireAuthorization("students.edit");

        app.MapPatch("/api/enrollments/{id:guid}/resume", async Task<IResult> (Guid id, EnrollmentStatusChangeRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (request.Reason?.Length > 500) return Results.ValidationProblem(new Dictionary<string, string[]> { ["reason"] = ["سبب الاستئناف يجب ألا يتجاوز 500 حرف."] });
            var effectiveOn = request.EffectiveOn ?? DateOnly.FromDateTime(DateTime.Today);
            if (effectiveOn > DateOnly.FromDateTime(DateTime.Today)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["effectiveOn"] = ["تاريخ الاستئناف لا يمكن أن يكون في المستقبل."] });
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            Guid studentId;
            await using (var owner = new NpgsqlCommand("SELECT student_id FROM circle_enrollments WHERE id=@id AND is_trashed=FALSE;", conn, tx))
            {
                owner.Parameters.AddWithValue("id", id);
                var value = await owner.ExecuteScalarAsync(ct);
                if (value is not Guid ownerId) return Results.NotFound();
                studentId = ownerId;
            }
            await using (var studentLock = new NpgsqlCommand("SELECT id FROM students WHERE id=@student AND is_trashed=FALSE FOR UPDATE;", conn, tx))
            {
                studentLock.Parameters.AddWithValue("student", studentId);
                if (await studentLock.ExecuteScalarAsync(ct) is not Guid) return Results.NotFound();
            }
            Guid circleId;
            await using var get = new NpgsqlCommand("SELECT circle_id,starts_on,ends_on,status FROM circle_enrollments WHERE id=@id AND student_id=@student AND is_trashed=FALSE FOR UPDATE;", conn, tx);
            get.Parameters.AddWithValue("id", id); get.Parameters.AddWithValue("student", studentId);
            await using var reader = await get.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return Results.NotFound();
            circleId = reader.GetGuid(0);
            var startsOn = reader.GetFieldValue<DateOnly>(1);
            var endsOn = reader.IsDBNull(2) ? (DateOnly?)null : reader.GetFieldValue<DateOnly>(2);
            var currentStatus = reader.GetString(3);
            await reader.DisposeAsync();
            if (currentStatus != "paused") return Results.Conflict(new { message = "لا يمكن استئناف هذا الالتحاق؛ يجب أن تكون حالته متوقفة مؤقتًا." });
            await using (var duplicate = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM circle_enrollments WHERE student_id=@student AND circle_id=@circle AND id<>@id AND is_trashed=FALSE AND status IN ('active','paused'));", conn, tx))
            {
                duplicate.Parameters.AddWithValue("student", studentId); duplicate.Parameters.AddWithValue("circle", circleId); duplicate.Parameters.AddWithValue("id", id);
                if ((bool)(await duplicate.ExecuteScalarAsync(ct) ?? false)) return Results.Conflict(new { message = "لا يمكن استئناف الالتحاق لأن للطالب سجل التحاق نشطًا أو متوقفًا آخر بهذه الحلقة. أنهِ السجل الآخر أولًا لتجنب ازدواج التاريخ." });
            }
            if (effectiveOn < startsOn || (endsOn.HasValue && effectiveOn > endsOn.Value)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["effectiveOn"] = ["تاريخ الاستئناف يجب أن يقع داخل فترة الالتحاق."] });
            await EnsureEnrollmentStatusBaselineAsync(conn, tx, id, startsOn, currentStatus, ActorId(principal), ct);
            var latestStatusDate = await GetLatestEnrollmentStatusDateAsync(conn, tx, id, ct);
            if (latestStatusDate.HasValue && effectiveOn < latestStatusDate.Value) return Results.ValidationProblem(new Dictionary<string, string[]> { ["effectiveOn"] = ["لا يمكن تسجيل الاستئناف بتاريخ يسبق آخر تغيير حالة مسجل."] });
            await using (var update = new NpgsqlCommand("UPDATE circle_enrollments SET status='active' WHERE id=@id AND status='paused';", conn, tx))
            { update.Parameters.AddWithValue("id", id); if (await update.ExecuteNonQueryAsync(ct) != 1) return Results.Conflict(new { message = "تغيرت حالة الالتحاق أثناء العملية. حدّث البيانات ثم أعد المحاولة." }); }
            await InsertEnrollmentStatusEventAsync(conn, tx, id, "enrollment.resume", "active", effectiveOn, request.Reason, ActorId(principal), ct);
            await tx.CommitAsync(ct);
            return Results.Ok(new { id, status = "active", effectiveOn });
        }).RequireAuthorization("students.edit");

        app.MapPatch("/api/enrollments/{id:guid}/end", async Task<IResult> (Guid id, EnrollmentEndRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var endsOn = request.EndsOn ?? DateOnly.FromDateTime(DateTime.Today);
            if (endsOn > DateOnly.FromDateTime(DateTime.Today)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["endsOn"] = ["تاريخ نهاية الالتحاق لا يمكن أن يكون في المستقبل."] });
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            await using var get = new NpgsqlCommand("SELECT student_id,circle_id,starts_on,agreed_monthly_fee,status FROM circle_enrollments WHERE id=@id AND is_trashed=FALSE FOR UPDATE;", conn, tx);
            get.Parameters.AddWithValue("id", id);
            await using var reader = await get.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return Results.NotFound();
            var studentId = reader.GetGuid(0);
            var circleId = reader.GetGuid(1);
            var startsOn = reader.GetFieldValue<DateOnly>(2);
            var agreedFee = reader.GetDecimal(3);
            var currentStatus = reader.GetString(4);
            await reader.DisposeAsync();
            if (currentStatus == "ended" || endsOn < startsOn) return Results.Conflict(new { message = "لم يُنهَ الالتحاق. تأكد أنه نشط أو متوقف مؤقتًا وأن تاريخ النهاية ليس قبل البداية." });
            await EnsureEnrollmentStatusBaselineAsync(conn, tx, id, startsOn, currentStatus, ActorId(principal), ct);
            var latestStatusDate = await GetLatestEnrollmentStatusDateAsync(conn, tx, id, ct);
            if (latestStatusDate.HasValue && endsOn < latestStatusDate.Value) return Results.ValidationProblem(new Dictionary<string, string[]> { ["endsOn"] = ["تاريخ نهاية الالتحاق لا يمكن أن يسبق آخر تغيير حالة مسجل."] });
            await using (var update = new NpgsqlCommand("UPDATE circle_enrollments SET status='ended',ends_on=@ends WHERE id=@id AND status IN ('active','paused');", conn, tx))
            { update.Parameters.AddWithValue("id", id); update.Parameters.AddWithValue("ends", endsOn); if (await update.ExecuteNonQueryAsync(ct) != 1) return Results.Conflict(new { message = "تغيرت حالة الالتحاق أثناء العملية. حدّث البيانات ثم أعد المحاولة." }); }
            await InsertEnrollmentStatusEventAsync(conn, tx, id, "enrollment.end", "ended", endsOn, "إنهاء الالتحاق من تفاصيل الحلقة.", ActorId(principal), ct);
            await tx.CommitAsync(ct);
            return Results.Ok(new { id, studentId, circleId, startsOn, endsOn, agreedMonthlyFee = CanReadFinance(principal) ? agreedFee : (decimal?)null, status = "ended" });
        }).RequireAuthorization("students.edit");
    }
}

public sealed record BulkEnrollmentStudent(Guid StudentId, decimal? AgreedMonthlyFee);

/// <summary>Bulk enrollment: the legacy studentIds list (circle fee applies) or a per-student
/// list with an explicit agreed monthly fee. The explicit list wins when both are present.</summary>
public sealed record BulkEnrollmentWriteRequest(
    Guid CircleId,
    DateOnly StartsOn,
    List<Guid>? StudentIds,
    bool AllowClosedCircle = false,
    List<BulkEnrollmentStudent>? Students = null);
