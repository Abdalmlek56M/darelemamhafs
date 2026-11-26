using System.Security.Claims;
using Dar.Common.Pagination;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private static void MapCircles(WebApplication app)
    {
        var route=app.MapGroup("/api/circles");
        route.MapGet("", (ClaimsPrincipal principal, string? search, int? page, int? pageSize, HttpContext http, NpgsqlDataSource db, CancellationToken ct) => LoadLegacyCirclesAsync(principal, search, page, pageSize, http, db, ct)).RequireAuthorization("circles.read");

        route.MapGet("/{id:guid}/students", async Task<IResult> (Guid id, ClaimsPrincipal principal, int? page, int? pageSize, HttpContext http, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var financeVisible = CanReadFinance(principal);
            var paging = new PageRequest(page, pageSize);
            var paged = page is not null || pageSize is not null;
            var query = """
              SELECT ce.id,ce.student_id,s.student_code,s.full_name,s.age_years,ce.starts_on,ce.ends_on,ce.status,ce.agreed_monthly_fee,
                     COALESCE(mc.amount_due,0),COALESCE(pay.paid,0),mc.id,COUNT(*) OVER() AS total
              FROM circle_enrollments ce JOIN students s ON s.id=ce.student_id
              LEFT JOIN monthly_charges mc ON mc.enrollment_id=ce.id AND mc.billing_month=date_trunc('month',CURRENT_DATE)::date AND mc.is_trashed=FALSE
              LEFT JOIN LATERAL(SELECT COALESCE(SUM(amount),0) paid FROM payments WHERE monthly_charge_id=mc.id AND is_trashed=FALSE AND voided_at IS NULL) pay ON TRUE
              WHERE ce.circle_id=@id AND ce.is_trashed=FALSE AND s.is_trashed=FALSE AND EXISTS(SELECT 1 FROM circles active_circle WHERE active_circle.id=ce.circle_id AND active_circle.is_trashed=FALSE)
              ORDER BY CASE ce.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,s.full_name,ce.id
              """;
            if (paged) query += " LIMIT @take OFFSET @skip";
            await using var cmd = db.CreateCommand(query);
            cmd.Parameters.AddWithValue("id", id);
            if (paged)
            {
                cmd.Parameters.AddWithValue("take", paging.PageSize);
                cmd.Parameters.AddWithValue("skip", paging.Offset);
            }
            var rows = new List<object>();
            long total = 0;
            await using (var reader = await cmd.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                {
                    total = reader.ReadTotal();
                    rows.Add(new {
                        enrollmentId=reader.GetGuid(0), studentId=reader.GetGuid(1), studentCode=reader.GetString(2), studentName=reader.GetString(3),
                        ageYears=reader.IsDBNull(4)?(int?)null:reader.GetInt32(4), startsOn=reader.GetFieldValue<DateOnly>(5),
                        endsOn=reader.IsDBNull(6)?(DateOnly?)null:reader.GetFieldValue<DateOnly>(6), enrollmentStatus=reader.GetString(7),
                        agreedMonthlyFee=financeVisible ? reader.GetDecimal(8) : (decimal?)null, currentMonthDue=financeVisible ? reader.GetDecimal(9) : (decimal?)null, currentMonthPaid=financeVisible ? reader.GetDecimal(10) : (decimal?)null,
                        chargeId=reader.IsDBNull(11)?(Guid?)null:reader.GetGuid(11)
                    });
                }
            }
            total = await PaginationRules.EnsureTotalAsync(cmd, total, paged, ct);
            PaginationHeaderWriter.Write(http.Response, total, paging, rows.Count, paged);
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
            catch(PostgresException ex) when(ex.SqlState=="0A000")
            { return Results.Conflict(new { message = "تعديل جدول المواعيد يتطلب مستوى العزل READ COMMITTED لضمان فحص التداخل بعد القفل." }); }
        }).RequireAuthorization("circles.create").AddEndpointFilter<ScopedAccessEndpointFilter>();

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
            catch(PostgresException ex) when(ex.SqlState=="0A000")
            { return Results.Conflict(new { message = "تعديل جدول المواعيد يتطلب مستوى العزل READ COMMITTED لضمان فحص التداخل بعد القفل." }); }
        }).RequireAuthorization("circles.edit").AddEndpointFilter<ScopedAccessEndpointFilter>();
        route.MapPost("/with-schedule", async Task<IResult> (CircleWithScheduleRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var circleRequest = new CircleWriteRequest(request.CircleCode, request.Name, request.TeacherId, request.MonthlyFee, request.ScheduleText, request.IsActive, request.StartsOn);
            var errors = ValidateCircle(circleRequest);
            if (errors is not null) return Results.ValidationProblem(errors);
            var drafts = request.Slots ?? [];
            var draftsErrors = ValidateScheduleDrafts(drafts, request.IsActive, request.TeacherId);
            if (draftsErrors is not null) return Results.ValidationProblem(draftsErrors);
            if (drafts.Count > 0 && !principal.HasClaim("permission", "schedule.edit")) return Results.Forbid();
            var canEditFinancials = CanEditFinancialValues(principal);
            if (!canEditFinancials && request.MonthlyFee is not null) return Results.Forbid();
            if (canEditFinancials && request.MonthlyFee is null)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["monthlyFee"] = ["الرسوم الشهرية مطلوبة عند إنشاء الحلقة مع صلاحية التعديل المالي."] });
            decimal monthlyFee = 0m;
            if (canEditFinancials && !MoneyRules.TryNormalizeNonNegativeCurrency(request.MonthlyFee!.Value, out monthlyFee))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["monthlyFee"] = ["رسوم الحلقة تتجاوز الحد المسموح أو لا يمكن تمثيلها بدقة منزلتين عشريتين."] });
            var code = string.IsNullOrWhiteSpace(request.CircleCode) ? NewCode("CIR") : request.CircleCode.Trim();
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            try
            {
                Guid circleId;
                await using (var insert = new NpgsqlCommand("INSERT INTO circles(circle_code,name,teacher_id,monthly_fee,schedule_text,is_active,starts_on) VALUES(@code,@name,@teacher,@fee,@schedule,@active,@starts) RETURNING id;", conn, tx))
                {
                    insert.Parameters.AddWithValue("code", code);
                    insert.Parameters.AddWithValue("name", request.Name.Trim());
                    AddNullableGuid(insert, "teacher", request.TeacherId);
                    insert.Parameters.AddWithValue("fee", monthlyFee);
                    AddNullable(insert, "schedule", request.ScheduleText);
                    insert.Parameters.AddWithValue("active", request.IsActive);
                    insert.Parameters.AddWithValue("starts", request.StartsOn);
                    circleId = (Guid)(await insert.ExecuteScalarAsync(ct) ?? throw new InvalidOperationException("لم يرجع سجل الحلقة."));
                }
                var savedSlots = await InsertScheduleDraftsAsync(conn, tx, circleId, drafts, principal, ct);
                await InsertCircleWriteAuditAsync(conn, tx, principal, "circle.create", circleId, request.Name, request.TeacherId, savedSlots.Count, ct);
                await tx.CommitAsync(ct);
                var created = await LoadCircle(db, circleId, CanReadFinance(principal), ct);
                return Results.Created($"/api/circles/{circleId}", new { circle = created, slots = savedSlots });
            }
            catch (PostgresException ex) when (ex.SqlState == "23505")
            {
                await tx.RollbackAsync(ct);
                return IsDuplicateScheduleSlotViolation(ex)
                    ? Results.Conflict(new { message = AtomicCircleSavePrefix + "أحد المواعيد مسجل بالفعل لنفس الحلقة في اليوم والوقت نفسيهما." })
                    : Results.Conflict(new { message = "كود الحلقة مستخدم بالفعل." });
            }
            catch (PostgresException ex) when (ex.SqlState == "23503")
            {
                await tx.RollbackAsync(ct);
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["teacherId"] = ["المعلمة المختارة غير موجودة."] });
            }
            catch (PostgresException ex) when (ex.SqlState == "23514" && ex.ConstraintName == "ck_teacher_schedule_no_overlap")
            {
                await tx.RollbackAsync(ct);
                return Results.Conflict(new { message = AtomicCircleSavePrefix + "توجد حصة أخرى للمعلمة نفسها تتداخل مع أحد مواعيد الحلقة. عدّل المواعيد ثم أعد المحاولة." });
            }
            catch (PostgresException ex) when (ex.SqlState == "0A000")
            {
                await tx.RollbackAsync(ct);
                return Results.Conflict(new { message = "تعديل جدول المواعيد يتطلب مستوى العزل READ COMMITTED لضمان فحص التداخل بعد القفل." });
            }
        }).RequireAuthorization("circles.create").AddEndpointFilter<ScopedAccessEndpointFilter>();

        route.MapPut("/{id:guid}/with-schedule", async Task<IResult> (Guid id, CircleWithScheduleRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var circleRequest = new CircleWriteRequest(request.CircleCode, request.Name, request.TeacherId, request.MonthlyFee, request.ScheduleText, request.IsActive, request.StartsOn);
            var errors = ValidateCircle(circleRequest);
            if (errors is not null) return Results.ValidationProblem(errors);
            var drafts = request.Slots ?? [];
            var draftsErrors = ValidateScheduleDrafts(drafts, request.IsActive, request.TeacherId);
            if (draftsErrors is not null) return Results.ValidationProblem(draftsErrors);
            if (drafts.Count > 0 && !principal.HasClaim("permission", "schedule.edit")) return Results.Forbid();
            var canEditFinancials = CanEditFinancialValues(principal);
            if (!canEditFinancials && request.MonthlyFee is not null) return Results.Forbid();
            decimal? monthlyFee = null;
            if (canEditFinancials)
            {
                if (request.MonthlyFee is null)
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["monthlyFee"] = ["الرسوم الشهرية مطلوبة عند تعديل البيانات المالية."] });
                if (!MoneyRules.TryNormalizeNonNegativeCurrency(request.MonthlyFee.Value, out var normalizedFee))
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["monthlyFee"] = ["رسوم الحلقة تتجاوز الحد المسموح أو لا يمكن تمثيلها بدقة منزلتين عشريتين."] });
                monthlyFee = normalizedFee;
            }
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            try
            {
                await using (var check = new NpgsqlCommand("SELECT id FROM circles WHERE id=@id AND is_trashed=FALSE FOR UPDATE;", conn, tx))
                {
                    check.Parameters.AddWithValue("id", id);
                    if (await check.ExecuteScalarAsync(ct) is null)
                    {
                        await tx.RollbackAsync(ct);
                        return Results.NotFound(new { message = "الحلقة غير موجودة أو موجودة في المهملات." });
                    }
                }
                await using (var update = new NpgsqlCommand("UPDATE circles SET circle_code=COALESCE(NULLIF(@code,''),circle_code),name=@name,teacher_id=@teacher,monthly_fee=COALESCE(@fee,monthly_fee),schedule_text=@schedule,is_active=@active,starts_on=@starts,updated_at=now() WHERE id=@id AND is_trashed=FALSE;", conn, tx))
                {
                    update.Parameters.AddWithValue("id", id);
                    update.Parameters.AddWithValue("code", request.CircleCode?.Trim() ?? string.Empty);
                    update.Parameters.AddWithValue("name", request.Name.Trim());
                    AddNullableGuid(update, "teacher", request.TeacherId);
                    update.Parameters.AddWithValue("fee", monthlyFee.HasValue ? (object)monthlyFee.Value : DBNull.Value);
                    AddNullable(update, "schedule", request.ScheduleText);
                    update.Parameters.AddWithValue("active", request.IsActive);
                    update.Parameters.AddWithValue("starts", request.StartsOn);
                    await update.ExecuteNonQueryAsync(ct);
                }
                var savedSlots = await InsertScheduleDraftsAsync(conn, tx, id, drafts, principal, ct);
                await InsertCircleWriteAuditAsync(conn, tx, principal, "circle.update", id, request.Name, request.TeacherId, savedSlots.Count, ct);
                await tx.CommitAsync(ct);
                var updated = await LoadCircle(db, id, CanReadFinance(principal), ct);
                return Results.Ok(new { circle = updated, slots = savedSlots });
            }
            catch (PostgresException ex) when (ex.SqlState == "23505")
            {
                await tx.RollbackAsync(ct);
                return IsDuplicateScheduleSlotViolation(ex)
                    ? Results.Conflict(new { message = AtomicCircleSavePrefix + "أحد المواعيد مسجل بالفعل لنفس الحلقة في اليوم والوقت نفسيهما." })
                    : Results.Conflict(new { message = "كود الحلقة مستخدم بالفعل." });
            }
            catch (PostgresException ex) when (ex.SqlState == "23503")
            {
                await tx.RollbackAsync(ct);
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["teacherId"] = ["المعلمة المختارة غير موجودة."] });
            }
            catch (PostgresException ex) when (ex.SqlState == "23514" && ex.ConstraintName == "ck_teacher_schedule_no_overlap")
            {
                await tx.RollbackAsync(ct);
                return Results.Conflict(new { message = AtomicCircleSavePrefix + "لا يمكن إسناد هذه المعلمة للحلقة أو تفعيلها؛ لديها حصة أخرى تتداخل مع أحد مواعيد الحلقة. عدّل المواعيد أولًا." });
            }
            catch (PostgresException ex) when (ex.SqlState == "0A000")
            {
                await tx.RollbackAsync(ct);
                return Results.Conflict(new { message = "تعديل جدول المواعيد يتطلب مستوى العزل READ COMMITTED لضمان فحص التداخل بعد القفل." });
            }
        }).RequireAuthorization("circles.edit").AddEndpointFilter<ScopedAccessEndpointFilter>();

    }

    private const string AtomicCircleSavePrefix = "لم تُحفظ الحلقة ولا مواعيدها (تم التراجع عن كل التغييرات). ";

    private static bool IsDuplicateScheduleSlotViolation(PostgresException ex) =>
        ex.ConstraintName is "uq_circle_schedule_slots_not_trashed_day_time" or "circle_schedule_slots_circle_id_day_of_week_starts_at_key";

    private static async Task<List<object>> InsertScheduleDraftsAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Guid circleId, IReadOnlyList<ScheduleSlotDraft> drafts, ClaimsPrincipal principal, CancellationToken ct)
    {
        var saved = new List<object>();
        foreach (var draft in drafts)
        {
            if (!TryParseScheduleSlotTime(draft.StartsAt, out var startsAt))
                throw new InvalidOperationException("تم تمرير وقت موعد غير صالح بعد التحقق.");
            Guid slotId;
            await using (var insert = new NpgsqlCommand("INSERT INTO circle_schedule_slots(circle_id,day_of_week,starts_at,duration_minutes,is_active) VALUES(@circle,@day,@time,@duration,TRUE) RETURNING id;", conn, tx))
            {
                insert.Parameters.AddWithValue("circle", circleId);
                insert.Parameters.AddWithValue("day", (short)draft.DayOfWeek);
                insert.Parameters.AddWithValue("time", startsAt);
                insert.Parameters.AddWithValue("duration", draft.DurationMinutes);
                slotId = (Guid)(await insert.ExecuteScalarAsync(ct) ?? throw new InvalidOperationException("لم يرجع سجل الموعد."));
            }
            await using (var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'schedule.create','circle_schedule_slot',@id,jsonb_build_object('dayOfWeek',@day,'startsAt',@time,'durationMinutes',@duration,'atomic',TRUE));", conn, tx))
            {
                audit.Parameters.AddWithValue("actor", ActorId(principal));
                audit.Parameters.AddWithValue("id", slotId);
                audit.Parameters.AddWithValue("day", draft.DayOfWeek);
                audit.Parameters.AddWithValue("time", startsAt.ToString("HH:mm"));
                audit.Parameters.AddWithValue("duration", draft.DurationMinutes);
                await audit.ExecuteNonQueryAsync(ct);
            }
            saved.Add(new { id = slotId, circleId, dayOfWeek = draft.DayOfWeek, startsAt = startsAt.ToString("HH:mm"), durationMinutes = draft.DurationMinutes });
        }
        return saved;
    }

    private static async Task InsertCircleWriteAuditAsync(NpgsqlConnection conn, NpgsqlTransaction tx, ClaimsPrincipal principal, string actionCode, Guid circleId, string name, Guid? teacherId, int slotCount, CancellationToken ct)
    {
        await using var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,@action,'circle',@id,jsonb_build_object('name',@name,'teacherId',@teacher,'scheduleSlots',@slots,'atomic',TRUE));", conn, tx);
        audit.Parameters.AddWithValue("actor", ActorId(principal));
        audit.Parameters.AddWithValue("action", actionCode);
        audit.Parameters.AddWithValue("id", circleId);
        audit.Parameters.AddWithValue("name", name.Trim());
        AddNullableGuid(audit, "teacher", teacherId);
        audit.Parameters.AddWithValue("slots", slotCount);
        await audit.ExecuteNonQueryAsync(ct);
    }
}
