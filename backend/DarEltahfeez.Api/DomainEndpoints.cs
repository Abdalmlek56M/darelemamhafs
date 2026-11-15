using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private const string StudentProjection = """
        SELECT s.id, s.student_code, s.full_name, s.age_years, s.phone, s.guardian_name, s.guardian_phone,
               s.joined_on, s.status, s.notes, s.created_at, s.updated_at,
               COALESCE((SELECT string_agg(c.name, '، ' ORDER BY c.name)
                         FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id
                         WHERE ce.student_id=s.id AND ce.status='active' AND ce.is_trashed=FALSE AND c.is_active=TRUE AND c.is_trashed=FALSE), ''),
               COALESCE((SELECT SUM(mc.amount_due) FROM circle_enrollments ce
                         JOIN monthly_charges mc ON mc.enrollment_id=ce.id AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date AND mc.is_trashed=FALSE
                         WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE), 0),
               COALESCE((SELECT SUM(p.amount) FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id
                         JOIN circle_enrollments ce ON ce.id=mc.enrollment_id
                         WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND p.is_trashed=FALSE AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date), 0),
               CASE
                 WHEN NOT EXISTS (SELECT 1 FROM circle_enrollments ce JOIN monthly_charges mc ON mc.enrollment_id=ce.id
                                  WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date) THEN 'not-set'
                 WHEN COALESCE((SELECT SUM(p.amount) FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id
                                JOIN circle_enrollments ce ON ce.id=mc.enrollment_id
                                WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND p.is_trashed=FALSE AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date), 0)
                    >= COALESCE((SELECT SUM(mc.amount_due) FROM circle_enrollments ce JOIN monthly_charges mc ON mc.enrollment_id=ce.id
                                 WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date), 0) THEN 'paid'
                 WHEN COALESCE((SELECT SUM(p.amount) FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id
                                JOIN circle_enrollments ce ON ce.id=mc.enrollment_id
                                WHERE ce.student_id=s.id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE AND p.is_trashed=FALSE AND mc.billing_month=date_trunc('month', CURRENT_DATE)::date), 0) > 0 THEN 'partial'
                 ELSE 'unpaid'
               END AS current_month_payment_status
        FROM students s
        """;

    public static void Map(WebApplication app)
    {
        MapStudents(app);
        MapTeachers(app);
        MapCircles(app);
        MapEnrollments(app);
        MapScheduleAndAttendance(app);
        MapCollections(app);
        MapAdvertisingExpenses(app);
        MapOperatingExpenses(app);
        MapReports(app);
    }

    private static void MapStudents(WebApplication app)
    {
        var route = app.MapGroup("/api/students");
        route.MapGet("", async Task<IResult> (ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var financeVisible = CanReadFinance(principal);
            var rows = new List<StudentResponse>();
            await using var cmd = db.CreateCommand(StudentProjection + " WHERE s.is_trashed=FALSE ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'withdrawn' THEN 2 ELSE 3 END, s.full_name;");
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(ReadStudent(reader, financeVisible));
            return Results.Ok(rows);
        }).RequireAuthorization("students.read");

        route.MapGet("/{id:guid}", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var cmd = db.CreateCommand(StudentProjection + " WHERE s.id=@id AND s.is_trashed=FALSE;");
            cmd.Parameters.AddWithValue("id", id);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return Results.NotFound();
            return Results.Ok(ReadStudent(reader, CanReadFinance(principal)));
        }).RequireAuthorization("students.read");

        route.MapPost("", async Task<IResult> (StudentWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var errors = ValidateStudent(request);
            if (errors is not null) return Results.ValidationProblem(errors);
            var code = string.IsNullOrWhiteSpace(request.StudentCode) ? NewCode("STU") : request.StudentCode.Trim();
            try
            {
                await using var cmd = db.CreateCommand("""
                    INSERT INTO students(student_code, full_name, age_years, phone, guardian_name, guardian_phone, joined_on, status, notes)
                    VALUES(@code, @name, @age, @phone, @guardian, @guardianPhone, @joined, @status, @notes)
                    RETURNING id;
                    """);
                AddStudentParams(cmd, request, code);
                var id = (Guid)(await cmd.ExecuteScalarAsync(ct) ?? throw new InvalidOperationException("لم يرجع سجل الطالب بعد الحفظ."));
                var saved = await LoadStudent(db, id, CanReadFinance(principal), ct);
                return Results.Created($"/api/students/{id}", saved);
            }
            catch (PostgresException ex) when (ex.SqlState == "23505")
            {
                return Results.Conflict(new { message = "كود الطالب مستخدم بالفعل. اختَر كودًا مختلفًا." });
            }
        }).RequireAuthorization("students.create");

        route.MapPut("/{id:guid}", async Task<IResult> (Guid id, StudentWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var errors = ValidateStudent(request);
            if (errors is not null) return Results.ValidationProblem(errors);
            await using var currentStatus = db.CreateCommand("SELECT status FROM students WHERE id=@id AND is_trashed=FALSE;");
            currentStatus.Parameters.AddWithValue("id", id);
            var savedStatus = (await currentStatus.ExecuteScalarAsync(ct)) as string;
            if (savedStatus is null) return Results.NotFound();
            if (!string.Equals(savedStatus, request.Status, StringComparison.Ordinal))
                return Results.Conflict(new { message = "غيّر حالة الطالب من قائمة الحالة؛ تغيير الحالة له إجراءات مرتبطة بالالتحاقات والتاريخ." });
            try
            {
                await using var cmd = db.CreateCommand("""
                    UPDATE students SET student_code=COALESCE(NULLIF(@code,''),student_code), full_name=@name, age_years=@age,
                        phone=@phone, guardian_name=@guardian, guardian_phone=@guardianPhone, joined_on=@joined,
                        notes=@notes, updated_at=now()
                    WHERE id=@id AND is_trashed=FALSE;
                    """);
                AddStudentParams(cmd, request, request.StudentCode?.Trim() ?? string.Empty);
                cmd.Parameters.AddWithValue("id", id);
                if (await cmd.ExecuteNonQueryAsync(ct) == 0) return Results.NotFound();
                return Results.Ok(await LoadStudent(db, id, CanReadFinance(principal), ct));
            }
            catch (PostgresException ex) when (ex.SqlState == "23505")
            {
                return Results.Conflict(new { message = "كود الطالب مستخدم بالفعل. اختَر كودًا مختلفًا." });
            }
        }).RequireAuthorization("students.edit");

        route.MapPatch("/{id:guid}/status", async Task<IResult> (Guid id, StudentStatusRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            string[] allowed = ["active", "paused", "withdrawn", "archived"];
            if (!allowed.Contains(request.Status, StringComparer.Ordinal))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["status"] = ["اختر حالة صحيحة للطالب."] });

            var effectiveOn = request.EffectiveOn ?? DateOnly.FromDateTime(DateTime.Today);
            if (effectiveOn > DateOnly.FromDateTime(DateTime.Today))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["effectiveOn"] = ["تاريخ تغيير الحالة لا يمكن أن يكون في المستقبل."] });

            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            try
            {
                DateOnly studentJoinedOn;
                await using (var studentLock = new NpgsqlCommand("SELECT joined_on FROM students WHERE id=@id AND is_trashed=FALSE FOR UPDATE;", conn, tx))
                {
                    studentLock.Parameters.AddWithValue("id", id);
                    var joinedValue = await studentLock.ExecuteScalarAsync(ct);
                    if (joinedValue is not DateOnly joinedOn) return Results.NotFound();
                    studentJoinedOn = joinedOn;
                }
                if (effectiveOn < studentJoinedOn)
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["effectiveOn"] = ["تاريخ تغيير حالة الطالب لا يمكن أن يسبق تاريخ تسجيله في الدار."] });

                if (request.Status == "archived")
                {
                    await using var activeEnrollments = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM circle_enrollments WHERE student_id=@id AND is_trashed=FALSE AND status IN ('active','paused'));", conn, tx);
                    activeEnrollments.Parameters.AddWithValue("id", id);
                    if ((bool)(await activeEnrollments.ExecuteScalarAsync(ct) ?? false))
                        return Results.Conflict(new { message = "لا يمكن أرشفة الطالب قبل إنهاء جميع الالتحاقات النشطة أو المتوقفة مؤقتًا." });
                }

                var endedEnrollments = new List<(Guid Id, DateOnly StartsOn, string Status)>();
                if (request.Status == "withdrawn")
                {
                    await using var enrollments = new NpgsqlCommand("SELECT id,starts_on,status FROM circle_enrollments WHERE student_id=@id AND is_trashed=FALSE AND status IN ('active','paused') ORDER BY starts_on,id FOR UPDATE;", conn, tx);
                    enrollments.Parameters.AddWithValue("id", id);
                    await using var reader = await enrollments.ExecuteReaderAsync(ct);
                    while (await reader.ReadAsync(ct)) endedEnrollments.Add((reader.GetGuid(0), reader.GetFieldValue<DateOnly>(1), reader.GetString(2)));
                    await reader.DisposeAsync();
                    if (endedEnrollments.Any(item => effectiveOn < item.StartsOn))
                        return Results.ValidationProblem(new Dictionary<string, string[]> { ["effectiveOn"] = ["تاريخ الانسحاب أقدم من بداية أحد الالتحاقات النشطة. أنهِ الالتحاق المستقبلي منفصلًا أو اختر تاريخًا مناسبًا."] });

                    foreach (var enrollment in endedEnrollments)
                    {
                        await EnsureEnrollmentStatusBaselineAsync(conn, tx, enrollment.Id, enrollment.StartsOn, enrollment.Status, ActorId(principal), ct);
                        var latestStatusDate = await GetLatestEnrollmentStatusDateAsync(conn, tx, enrollment.Id, ct);
                        if (latestStatusDate.HasValue && effectiveOn < latestStatusDate.Value)
                            return Results.ValidationProblem(new Dictionary<string, string[]> { ["effectiveOn"] = ["تاريخ الانسحاب يسبق آخر تغيير حالة في أحد الالتحاقات. اختر تاريخًا مساويًا أو أحدث."] });
                        await using (var updateEnrollment = new NpgsqlCommand("UPDATE circle_enrollments SET status='ended',ends_on=@ends WHERE id=@id AND status IN ('active','paused');", conn, tx))
                        {
                            updateEnrollment.Parameters.AddWithValue("id", enrollment.Id);
                            updateEnrollment.Parameters.AddWithValue("ends", effectiveOn);
                            await updateEnrollment.ExecuteNonQueryAsync(ct);
                        }
                        await InsertEnrollmentStatusEventAsync(conn, tx, enrollment.Id, "enrollment.end", "ended", effectiveOn, "إنهاء جميع الالتحاقات بسبب الانسحاب النهائي من الدار.", ActorId(principal), ct);
                    }
                }

                await using (var updateStudent = new NpgsqlCommand("UPDATE students SET status=@status,updated_at=now() WHERE id=@id AND is_trashed=FALSE;", conn, tx))
                {
                    updateStudent.Parameters.AddWithValue("id", id);
                    updateStudent.Parameters.AddWithValue("status", request.Status);
                    await updateStudent.ExecuteNonQueryAsync(ct);
                }
                await using (var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'student.status.change','student',@id,jsonb_build_object('status',@status,'effectiveOn',@effectiveOn,'endedEnrollments',@endedCount));", conn, tx))
                {
                    audit.Parameters.AddWithValue("actor", ActorId(principal));
                    audit.Parameters.AddWithValue("id", id);
                    audit.Parameters.AddWithValue("status", request.Status);
                    audit.Parameters.AddWithValue("effectiveOn", effectiveOn);
                    audit.Parameters.AddWithValue("endedCount", endedEnrollments.Count);
                    await audit.ExecuteNonQueryAsync(ct);
                }
                await tx.CommitAsync(ct);
                return Results.Ok(await LoadStudent(db, id, CanReadFinance(principal), ct));
            }
            catch
            {
                await tx.RollbackAsync(ct);
                throw;
            }
        }).RequireAuthorization("students.edit");

        route.MapDelete("/{id:guid}", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            string? code;
            string? name;
            await using (var delete = new NpgsqlCommand("DELETE FROM students WHERE id=@id RETURNING student_code, full_name;", conn, tx))
            {
                delete.Parameters.AddWithValue("id", id);
                await using var reader = await delete.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct)) return Results.NotFound();
                code = reader.GetString(0); name = reader.GetString(1);
            }
            await using (var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'student.delete','student',@id,jsonb_build_object('code',@code,'name',@name));", conn, tx))
            {
                audit.Parameters.AddWithValue("actor", ActorId(principal));
                audit.Parameters.AddWithValue("id", id);
                audit.Parameters.AddWithValue("code", code!);
                audit.Parameters.AddWithValue("name", name!);
                await audit.ExecuteNonQueryAsync(ct);
            }
            await tx.CommitAsync(ct);
            return Results.Ok(new { id, message = "تم حذف الطالب وسجلاته المرتبطة نهائيًا." });
        }).RequireAuthorization("students.delete");

        route.MapGet("/{id:guid}/history", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) => await StudentHistory(db, id, principal, ct))
            .RequireAuthorization("students.read");

        route.MapPost("/{id:guid}/notes", async Task<IResult> (Guid id, StudentNoteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.NoteText) || request.NoteText.Trim().Length > 10000)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["noteText"] = ["اكتب ملاحظة من 1 إلى 10000 حرف."] });
            await using var cmd = db.CreateCommand("INSERT INTO student_notes(student_id,note_text,created_by) SELECT s.id,@text,@actor FROM students s WHERE s.id=@student AND s.is_trashed=FALSE RETURNING id, note_text, created_at;");
            cmd.Parameters.AddWithValue("student", id);
            cmd.Parameters.AddWithValue("text", request.NoteText.Trim());
            cmd.Parameters.AddWithValue("actor", ActorId(principal));
            try
            {
                await using var reader = await cmd.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct)) return Results.NotFound();
                return Results.Created($"/api/students/{id}/history", new StudentNoteResponse(reader.GetGuid(0), reader.GetString(1), reader.GetFieldValue<DateTimeOffset>(2), principal.FindFirstValue("display_name") ?? principal.Identity?.Name ?? ""));
            }
            catch (PostgresException ex) when (ex.SqlState == "23503") { return Results.NotFound(); }
        }).RequireAuthorization("students.edit");

        route.MapDelete("/{studentId:guid}/notes/{noteId:guid}", async Task<IResult> (Guid studentId, Guid noteId, NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var cmd = db.CreateCommand("DELETE FROM student_notes WHERE id=@note AND student_id=@student RETURNING id;");
            cmd.Parameters.AddWithValue("note", noteId); cmd.Parameters.AddWithValue("student", studentId);
            if (await cmd.ExecuteScalarAsync(ct) is null) return Results.NotFound();
            return Results.Ok(new { deleted = true });
        }).RequireAuthorization("students.edit");
    }

    private static void MapTeachers(WebApplication app)
    {
        var route = app.MapGroup("/api/teachers");
        route.MapGet("", async Task<IResult> (ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var financeVisible = CanReadFinance(principal);
            var rows = new List<TeacherResponse>();
            await using var cmd = db.CreateCommand("""
                SELECT t.id,t.teacher_code,t.full_name,t.phone,t.hourly_rate,t.status,t.notes,t.created_at,t.updated_at,
                    COALESCE((SELECT string_agg(c.name,'، ' ORDER BY c.name) FROM circles c WHERE c.teacher_id=t.id AND c.is_trashed=FALSE), '') AS circle_names,
                    (SELECT COUNT(*) FROM circles c WHERE c.teacher_id=t.id AND c.is_trashed=FALSE) AS circle_count
                FROM teachers t WHERE t.is_trashed=FALSE ORDER BY CASE t.status WHEN 'active' THEN 0 WHEN 'inactive' THEN 1 ELSE 2 END,t.full_name;
                """);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(ReadTeacher(reader, financeVisible));
            return Results.Ok(rows);
        }).RequireAuthorization("teachers.read");

        route.MapGet("/{id:guid}/history", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) => await TeacherHistory(db, id, principal, ct))
            .RequireAuthorization("teachers.read");

        route.MapPost("/{id:guid}/notes", async Task<IResult> (Guid id, StudentNoteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.NoteText) || request.NoteText.Trim().Length > 10000)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["noteText"] = ["اكتب ملاحظة من 1 إلى 10000 حرف."] });
            await using var cmd = db.CreateCommand("INSERT INTO teacher_notes(teacher_id,note_text,created_by) SELECT t.id,@text,@actor FROM teachers t WHERE t.id=@teacher AND t.is_trashed=FALSE RETURNING id,note_text,created_at;");
            cmd.Parameters.AddWithValue("teacher", id); cmd.Parameters.AddWithValue("text", request.NoteText.Trim()); cmd.Parameters.AddWithValue("actor", ActorId(principal));
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return Results.NotFound();
            return Results.Created($"/api/teachers/{id}/history", new StudentNoteResponse(reader.GetGuid(0), reader.GetString(1), reader.GetFieldValue<DateTimeOffset>(2), principal.FindFirstValue("display_name") ?? principal.Identity?.Name ?? ""));
        }).RequireAuthorization("teachers.edit");

        route.MapPost("", async Task<IResult> (TeacherWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var errors = ValidateTeacher(request); if (errors is not null) return Results.ValidationProblem(errors);
            var canEditFinancials = CanEditFinancialValues(principal);
            if (!canEditFinancials && request.HourlyRate is not null) return Results.Forbid();
            var hourlyRate = 0m;
            if (canEditFinancials && request.HourlyRate is null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["hourlyRate"] = ["أجر الساعة مطلوب عند إنشاء المعلمة مع صلاحية التعديل المالي."] });
            if (canEditFinancials && !MoneyRules.TryNormalizeNonNegativeCurrency(request.HourlyRate!.Value, out hourlyRate))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["hourlyRate"] = ["أجر الساعة يتجاوز الحد المسموح أو لا يمكن تمثيله بدقة منزلتين عشريتين."] });
            var code = string.IsNullOrWhiteSpace(request.TeacherCode) ? NewCode("TCH") : request.TeacherCode.Trim();
            try
            {
                await using var cmd = db.CreateCommand("INSERT INTO teachers(teacher_code,full_name,phone,hourly_rate,status,notes) VALUES(@code,@name,@phone,@rate,@status,@notes) RETURNING id;");
                cmd.Parameters.AddWithValue("code", code); cmd.Parameters.AddWithValue("name", request.FullName.Trim()); AddNullable(cmd,"phone",request.Phone);
                cmd.Parameters.AddWithValue("rate", hourlyRate); cmd.Parameters.AddWithValue("status", request.Status); AddNullable(cmd,"notes",request.Notes);
                var id=(Guid)(await cmd.ExecuteScalarAsync(ct) ?? throw new InvalidOperationException("لم يرجع سجل المعلمة."));
                return Results.Created($"/api/teachers/{id}", await LoadTeacher(db,id,CanReadFinance(principal),ct));
            }
            catch (PostgresException ex) when (ex.SqlState == "23505") { return Results.Conflict(new { message = "كود المعلمة مستخدم بالفعل." }); }
        }).RequireAuthorization("teachers.create");

        route.MapPut("/{id:guid}", async Task<IResult> (Guid id, TeacherWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var errors=ValidateTeacher(request); if(errors is not null) return Results.ValidationProblem(errors);
            var canEditFinancials = CanEditFinancialValues(principal);
            if (!canEditFinancials && request.HourlyRate is not null) return Results.Forbid();
            decimal? hourlyRate = null;
            if (canEditFinancials) { if (request.HourlyRate is null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["hourlyRate"] = ["أجر الساعة مطلوب عند تعديل البيانات المالية."] }); if (!MoneyRules.TryNormalizeNonNegativeCurrency(request.HourlyRate.Value, out var normalizedRate))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["hourlyRate"] = ["أجر الساعة يتجاوز الحد المسموح أو لا يمكن تمثيله بدقة منزلتين عشريتين."] }); hourlyRate = normalizedRate; }
            try
            {
                await using var cmd=db.CreateCommand("UPDATE teachers SET teacher_code=COALESCE(NULLIF(@code,''),teacher_code),full_name=@name,phone=@phone,hourly_rate=COALESCE(@rate,hourly_rate),status=@status,notes=@notes,updated_at=now() WHERE id=@id AND is_trashed=FALSE;");
                cmd.Parameters.AddWithValue("id",id); cmd.Parameters.AddWithValue("code",request.TeacherCode?.Trim()??string.Empty); cmd.Parameters.AddWithValue("name",request.FullName.Trim()); AddNullable(cmd,"phone",request.Phone);
                cmd.Parameters.AddWithValue("rate",hourlyRate.HasValue ? (object)hourlyRate.Value : DBNull.Value); cmd.Parameters.AddWithValue("status",request.Status); AddNullable(cmd,"notes",request.Notes);
                if(await cmd.ExecuteNonQueryAsync(ct)==0) return Results.NotFound();
                return Results.Ok(await LoadTeacher(db,id,CanReadFinance(principal),ct));
            }
            catch(PostgresException ex) when(ex.SqlState=="23505"){return Results.Conflict(new {message="كود المعلمة مستخدم بالفعل."});}
        }).RequireAuthorization("teachers.edit");

        route.MapDelete("/{id:guid}", async Task<IResult> (Guid id, NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var cmd=db.CreateCommand("DELETE FROM teachers WHERE id=@id AND NOT EXISTS(SELECT 1 FROM circles WHERE teacher_id=@id) RETURNING id;");
            cmd.Parameters.AddWithValue("id",id);
            try
            {
                if (await cmd.ExecuteScalarAsync(ct) is null) return Results.Conflict(new { message = "لم تُحذف المعلمة: ربما لا توجد، أو ما زالت مرتبطة بحلقات. انقل الحلقات أو احذفها أولًا." });
                return Results.Ok(new { id, deleted = true });
            }
            catch(PostgresException ex) when(ex.SqlState=="23503"){return Results.Conflict(new {message="المعلمة مرتبطة بسجلات أخرى ولا يمكن حذفها حاليًا."});}
        }).RequireAuthorization("teachers.delete");
    }

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

    private static void MapScheduleAndAttendance(WebApplication app)
    {
        app.MapGet("/api/schedule-slots", async Task<IResult> (NpgsqlDataSource db, CancellationToken ct) =>
        {
            var rows = new List<object>();
            await using var cmd = db.CreateCommand("""
                SELECT ss.id,ss.circle_id,c.name,c.teacher_id,COALESCE(t.full_name,''),ss.day_of_week,ss.starts_at,ss.duration_minutes,ss.is_active
                FROM circle_schedule_slots ss JOIN circles c ON c.id=ss.circle_id
                LEFT JOIN teachers t ON t.id=c.teacher_id
                WHERE ss.is_trashed=FALSE AND c.is_trashed=FALSE
                  AND (ss.is_active=TRUE OR EXISTS(SELECT 1 FROM teacher_attendance ta WHERE ta.schedule_slot_id=ss.id AND ta.is_trashed=FALSE)
                    OR EXISTS(SELECT 1 FROM student_attendance sa WHERE sa.schedule_slot_id=ss.id AND sa.is_trashed=FALSE))
                ORDER BY ss.is_active DESC,ss.day_of_week,ss.starts_at,c.name;
                """);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(new
            {
                id = reader.GetGuid(0), circleId = reader.GetGuid(1), circleName = reader.GetString(2),
                teacherId = reader.IsDBNull(3) ? (Guid?)null : reader.GetGuid(3), teacherName = reader.GetString(4),
                dayOfWeek = reader.GetInt16(5), startsAt = reader.GetFieldValue<TimeOnly>(6).ToString("HH:mm"), durationMinutes = reader.GetInt32(7), isActive = reader.GetBoolean(8)
            });
            return Results.Ok(rows);
        }).RequireAuthorization("schedule.access");

        app.MapPost("/api/schedule-slots", async Task<IResult> (ScheduleSlotWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (request.CircleId == Guid.Empty || request.DayOfWeek is < 0 or > 6 || request.DurationMinutes is < 15 or > 360 ||
                !TimeOnly.TryParseExact(request.StartsAt, "HH:mm", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var startsAt))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["schedule"] = ["حدد الحلقة واليوم والوقت، واجعل مدة الحلقة من 15 إلى 360 دقيقة."] });
            try
            {
                await using var cmd = db.CreateCommand("""
                    INSERT INTO circle_schedule_slots(circle_id,day_of_week,starts_at,duration_minutes,is_active)
                    SELECT c.id,@day,@time,@duration,TRUE FROM circles c
                    WHERE c.id=@circle AND c.is_trashed=FALSE AND c.is_active=TRUE AND c.teacher_id IS NOT NULL
                    RETURNING id;
                    """);
                cmd.Parameters.AddWithValue("circle", request.CircleId); cmd.Parameters.AddWithValue("day", (short)request.DayOfWeek);
                cmd.Parameters.AddWithValue("time", startsAt); cmd.Parameters.AddWithValue("duration", request.DurationMinutes);
                var value = await cmd.ExecuteScalarAsync(ct);
                if (value is null) return Results.Conflict(new { message = "الحلقة غير موجودة أو متوقفة أو لم تُسند إلى معلمة. فعّل الحلقة وحدد المعلمة المسؤولة أولًا." });
                var id = (Guid)value;
                await using var audit = db.CreateCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'schedule.create','circle_schedule_slot',@id,jsonb_build_object('dayOfWeek',@day,'startsAt',@time,'durationMinutes',@duration));");
                audit.Parameters.AddWithValue("actor", ActorId(principal)); audit.Parameters.AddWithValue("id", id); audit.Parameters.AddWithValue("day", request.DayOfWeek); audit.Parameters.AddWithValue("time", startsAt.ToString("HH:mm")); audit.Parameters.AddWithValue("duration", request.DurationMinutes); await audit.ExecuteNonQueryAsync(ct);
                return Results.Created($"/api/schedule-slots/{id}", new { id, request.CircleId, request.DayOfWeek, startsAt = startsAt.ToString("HH:mm"), request.DurationMinutes });
            }
            catch (PostgresException ex) when (ex.SqlState == "23505") { return Results.Conflict(new { message = "هذا الموعد مسجل للحلقة في اليوم والوقت نفسيهما بالفعل." }); }
            catch (PostgresException ex) when (ex.SqlState == "23514" && ex.ConstraintName == "ck_teacher_schedule_no_overlap")
            { return Results.Conflict(new { message = "توجد حصة أخرى للمعلمة نفسها تتداخل مع هذا الموعد. اختر وقتًا غير متداخل؛ يُسمح بالمواعيد المتتالية." }); }
        }).RequireAuthorization("schedule.edit");

        app.MapDelete("/api/schedule-slots/{id:guid}", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            bool exists, hasAttendance;
            await using (var check = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM circle_schedule_slots WHERE id=@id AND is_trashed=FALSE), (EXISTS(SELECT 1 FROM teacher_attendance WHERE schedule_slot_id=@id AND is_trashed=FALSE) OR EXISTS(SELECT 1 FROM student_attendance WHERE schedule_slot_id=@id AND is_trashed=FALSE));", conn, tx))
            {
                check.Parameters.AddWithValue("id", id); await using var reader = await check.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct)) return Results.NotFound(); exists = reader.GetBoolean(0); hasAttendance = reader.GetBoolean(1);
            }
            if (!exists) return Results.NotFound();
            await using (var change = new NpgsqlCommand(hasAttendance ? "UPDATE circle_schedule_slots SET is_active=FALSE WHERE id=@id;" : "DELETE FROM circle_schedule_slots WHERE id=@id;", conn, tx))
            { change.Parameters.AddWithValue("id", id); await change.ExecuteNonQueryAsync(ct); }
            await using (var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'schedule.remove','circle_schedule_slot',@id,jsonb_build_object('preservedAttendance',@preserved));", conn, tx))
            { audit.Parameters.AddWithValue("actor", ActorId(principal)); audit.Parameters.AddWithValue("id", id); audit.Parameters.AddWithValue("preserved", hasAttendance); await audit.ExecuteNonQueryAsync(ct); }
            await tx.CommitAsync(ct);
            return Results.Ok(new { id, removed = true, historicalAttendancePreserved = hasAttendance });
        }).RequireAuthorization("schedule.edit");

        app.MapGet("/api/teacher-attendance", async Task<IResult> (string? month, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var financeVisible = CanReadFinance(principal);
            if (!TryMonth(month, out var from)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
            var to = from.AddMonths(1);
            var rows = new List<object>();
            await using var cmd = db.CreateCommand("""
                SELECT a.id,a.schedule_slot_id,a.circle_id,c.name,a.teacher_id,t.full_name,a.session_date,a.scheduled_start,a.duration_minutes,a.status,a.hourly_rate_snapshot,a.payable_amount,a.note,a.marked_at
                FROM teacher_attendance a JOIN circles c ON c.id=a.circle_id JOIN teachers t ON t.id=a.teacher_id
                WHERE a.session_date>=@from AND a.session_date<@to AND a.is_trashed=FALSE AND c.is_trashed=FALSE
                ORDER BY a.session_date DESC,a.scheduled_start DESC,t.full_name;
                """);
            cmd.Parameters.AddWithValue("from", from); cmd.Parameters.AddWithValue("to", to);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(new
            {
                id = reader.GetGuid(0), scheduleSlotId = reader.IsDBNull(1) ? (Guid?)null : reader.GetGuid(1), circleId = reader.GetGuid(2), circleName = reader.GetString(3),
                teacherId = reader.GetGuid(4), teacherName = reader.GetString(5), sessionDate = reader.GetFieldValue<DateOnly>(6), startsAt = reader.GetFieldValue<TimeOnly>(7).ToString("HH:mm"),
                durationMinutes = reader.GetInt32(8), status = reader.GetString(9), hourlyRateSnapshot = financeVisible ? reader.GetDecimal(10) : (decimal?)null, payableAmount = financeVisible ? reader.GetDecimal(11) : (decimal?)null,
                note = reader.IsDBNull(12) ? null : reader.GetString(12), markedAt = reader.GetFieldValue<DateTimeOffset>(13)
            });
            return Results.Ok(rows);
        }).RequireAuthorization("attendance.access");

        app.MapPut("/api/teacher-attendance/{id:guid}/duration", async Task<IResult> (Guid id, TeacherAttendanceDurationRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (request.DurationMinutes is < 15 or > 360)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["durationMinutes"] = ["مدة الحصة يجب أن تكون من 15 إلى 360 دقيقة."] });
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            string? before;
            decimal hourlyRateSnapshot;
            string? savedStatus;
            await using (var read = new NpgsqlCommand("SELECT to_jsonb(a)::text,a.hourly_rate_snapshot,a.status FROM teacher_attendance a WHERE id=@id AND is_trashed=FALSE FOR UPDATE;", conn, tx))
            {
                read.Parameters.AddWithValue("id", id);
                await using var reader = await read.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct)) return Results.NotFound(new { message = "سجل الحضور غير موجود أو موجود في المهملات." });
                before = reader.GetString(0);
                hourlyRateSnapshot = reader.GetDecimal(1);
                savedStatus = reader.GetString(2);
            }
            if (savedStatus != "present") return Results.Conflict(new { message = "لا يمكن تعديل مدة حصة عند تسجيل المعلمة غائبة أو إلغاء الحصة. سجّل الحضور أولًا إذا كانت الحالة غير صحيحة." });
            if (!MoneyRules.TryCalculateTeacherPayableAmount(hourlyRateSnapshot, request.DurationMinutes, out var normalizedPayable))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["durationMinutes"] = ["قيمة المستحق الناتج تتجاوز الحد المالي المسموح لهذه الحصة."] });
            await using var update = new NpgsqlCommand("UPDATE teacher_attendance SET duration_minutes=@duration,payable_amount=@payable,marked_by=@actor,marked_at=now() WHERE id=@id AND status='present' RETURNING id,duration_minutes,payable_amount,hourly_rate_snapshot,status;", conn, tx);
            update.Parameters.AddWithValue("id", id); update.Parameters.AddWithValue("duration", request.DurationMinutes); update.Parameters.AddWithValue("payable", normalizedPayable); update.Parameters.AddWithValue("actor", ActorId(principal));
            Guid savedId; int duration; decimal payable, rate; string status;
            await using (var reader = await update.ExecuteReaderAsync(ct)) { await reader.ReadAsync(ct); savedId=reader.GetGuid(0); duration=reader.GetInt32(1); payable=reader.GetDecimal(2); rate=reader.GetDecimal(3); status=reader.GetString(4); }
            await using (var afterCmd = new NpgsqlCommand("SELECT to_jsonb(a)::text FROM teacher_attendance a WHERE id=@id;", conn, tx))
            { afterCmd.Parameters.AddWithValue("id", id); var after=(string?)await afterCmd.ExecuteScalarAsync(ct);
              await using var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,actor_display_name,action_code,entity_type,entity_id,details,before_data,after_data,request_path,http_method,can_restore) VALUES(@actor,@name,'attendance.duration.update','teacher_attendance',@id,jsonb_build_object('durationMinutes',@duration,'payableAmount',@payable),@before::jsonb,@after::jsonb,'/api/teacher-attendance/'||@id||'/duration','PUT',TRUE);", conn, tx);
              audit.Parameters.AddWithValue("actor", ActorId(principal)); audit.Parameters.AddWithValue("name", principal.FindFirstValue("display_name") ?? "حساب غير معروف"); audit.Parameters.AddWithValue("id", id); audit.Parameters.AddWithValue("duration", duration); audit.Parameters.AddWithValue("payable", payable); audit.Parameters.AddWithValue("before", before); audit.Parameters.AddWithValue("after", (object?)after ?? DBNull.Value); await audit.ExecuteNonQueryAsync(ct); }
            await tx.CommitAsync(ct);
            return Results.Ok(new { id=savedId, durationMinutes=duration, payableAmount=CanReadFinance(principal) ? payable : (decimal?)null, hourlyRateSnapshot=CanReadFinance(principal) ? rate : (decimal?)null, status });
        }).RequireAuthorization("attendance.edit");

        app.MapGet("/api/student-attendance/roster", async Task<IResult> (Guid scheduleSlotId, DateOnly date, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var rows = new List<object>();
            await using var cmd = db.CreateCommand("""
                WITH candidates AS (
                    SELECT ce.id AS enrollment_id, s.id AS student_id, s.student_code, s.full_name,
                           sa.status, sa.note,
                           (ce.starts_on<=@date AND (ce.ends_on IS NULL OR ce.ends_on>=@date) AND attendance_circle.starts_on<=@date
                             AND public.dar_enrollment_is_attendance_eligible_on_date(ce.id,@date)) AS eligible_for_date,
                           CASE
                             WHEN attendance_circle.starts_on>@date THEN 'before-circle-start'
                             WHEN ce.starts_on>@date THEN 'before-enrollment-start'
                             WHEN ce.ends_on IS NOT NULL AND @date>ce.ends_on THEN 'after-enrollment-end'
                             WHEN COALESCE(lifecycle.status_at_date, CASE WHEN ce.ends_on IS NOT NULL AND @date>ce.ends_on THEN 'ended' WHEN ce.status='paused' AND @date>=CURRENT_DATE THEN 'paused' ELSE 'active' END)='paused' THEN 'paused'
                             WHEN NOT public.dar_enrollment_is_attendance_eligible_on_date(ce.id,@date) THEN 'not-active-on-date'
                             ELSE NULL
                           END AS eligibility_reason,
                           ce.starts_on, ce.ends_on,
                           COALESCE(lifecycle.status_at_date, CASE WHEN ce.ends_on IS NOT NULL AND @date>ce.ends_on THEN 'ended' WHEN ce.status='paused' AND @date>=CURRENT_DATE THEN 'paused' ELSE 'active' END) AS enrollment_status_at_date,
                           ROW_NUMBER() OVER (
                             PARTITION BY s.id
                             ORDER BY (sa.id IS NOT NULL) DESC,
                                      (ce.starts_on<=@date AND (ce.ends_on IS NULL OR ce.ends_on>=@date) AND attendance_circle.starts_on<=@date
                                        AND public.dar_enrollment_is_attendance_eligible_on_date(ce.id,@date)) DESC,
                                      (ce.status='active') DESC, ce.starts_on DESC, ce.created_at DESC, ce.id DESC
                           ) AS student_row
                    FROM circle_schedule_slots ss
                    JOIN circle_enrollments ce ON ce.circle_id=ss.circle_id AND ce.is_trashed=FALSE
                    JOIN circles attendance_circle ON attendance_circle.id=ss.circle_id AND attendance_circle.is_trashed=FALSE
                    JOIN students s ON s.id=ce.student_id AND s.is_trashed=FALSE
                    LEFT JOIN student_attendance sa ON sa.enrollment_id=ce.id AND sa.schedule_slot_id=ss.id AND sa.session_date=@date AND sa.is_trashed=FALSE
                    LEFT JOIN LATERAL (
                        SELECT public.dar_enrollment_status_at_date(ce.id,@date) AS status_at_date
                    ) lifecycle ON TRUE
                    WHERE ss.id=@slot AND ss.is_trashed=FALSE
                )
                SELECT enrollment_id,student_id,student_code,full_name,status,note,eligible_for_date,eligibility_reason,starts_on,ends_on,enrollment_status_at_date
                FROM candidates WHERE student_row=1
                ORDER BY eligible_for_date DESC,full_name;
                """);
            cmd.Parameters.AddWithValue("slot", scheduleSlotId); cmd.Parameters.AddWithValue("date", date);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(new { enrollmentId=reader.GetGuid(0), studentId=reader.GetGuid(1), studentCode=reader.GetString(2), studentName=reader.GetString(3), status=reader.IsDBNull(4)?null:reader.GetString(4), note=reader.IsDBNull(5)?null:reader.GetString(5), eligibleForDate=reader.GetBoolean(6), eligibilityReason=reader.IsDBNull(7)?null:reader.GetString(7), startsOn=reader.GetFieldValue<DateOnly>(8), endsOn=reader.IsDBNull(9)?(DateOnly?)null:reader.GetFieldValue<DateOnly>(9), enrollmentStatus=reader.GetString(10) });
            return Results.Ok(rows);
        }).RequireAuthorization("attendance.access");

        app.MapGet("/api/student-attendance/session-summary", async Task<IResult> (string? month, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!TryMonth(month, out var from)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
            var rows = new List<object>();
            await using var cmd = db.CreateCommand("""
                WITH month_days AS (
                    SELECT day_value::date AS session_date
                    FROM generate_series(@from::date::timestamp, (@to::date - 1)::timestamp, interval '1 day') AS day_value
                ),
                sessions AS (
                    SELECT ss.id AS slot_id, ss.circle_id, d.session_date
                    FROM month_days d
                    JOIN circle_schedule_slots ss ON ss.day_of_week=EXTRACT(DOW FROM d.session_date)::smallint
                    JOIN circles c ON c.id=ss.circle_id AND c.is_trashed=FALSE
                    WHERE ss.is_active=TRUE AND ss.is_trashed=FALSE
                    UNION
                    SELECT ta.schedule_slot_id, ta.circle_id, ta.session_date
                    FROM teacher_attendance ta
                    JOIN circle_schedule_slots ss ON ss.id=ta.schedule_slot_id AND ss.is_trashed=FALSE
                    WHERE ta.is_trashed=FALSE AND ta.schedule_slot_id IS NOT NULL AND ta.session_date>=@from AND ta.session_date<@to
                    UNION
                    SELECT sa.schedule_slot_id, ce.circle_id, sa.session_date
                    FROM student_attendance sa
                    JOIN circle_schedule_slots ss ON ss.id=sa.schedule_slot_id AND ss.is_trashed=FALSE
                    JOIN circle_enrollments ce ON ce.id=sa.enrollment_id AND ce.is_trashed=FALSE
                    WHERE sa.is_trashed=FALSE AND sa.session_date>=@from AND sa.session_date<@to
                ),
                per_student AS (
                    SELECT ses.slot_id,ses.session_date,s.id AS student_id,
                           BOOL_OR(ce.starts_on<=ses.session_date AND (ce.ends_on IS NULL OR ce.ends_on>=ses.session_date)
                             AND session_circle.starts_on<=ses.session_date
                             AND public.dar_enrollment_is_attendance_eligible_on_date(ce.id,ses.session_date)) AS eligible_for_date,
                           BOOL_OR(sa.id IS NOT NULL) AS has_saved_attendance,
                           BOOL_OR(sa.status='present') AS is_present,
                           BOOL_OR(ce.status='active' AND (ce.ends_on IS NULL OR ce.ends_on>=CURRENT_DATE) AND session_circle.starts_on<=CURRENT_DATE) AS is_current_roster
                    FROM sessions ses
                    JOIN circle_enrollments ce ON ce.circle_id=ses.circle_id AND ce.is_trashed=FALSE
                    JOIN students s ON s.id=ce.student_id AND s.is_trashed=FALSE
                    JOIN circles session_circle ON session_circle.id=ses.circle_id AND session_circle.is_trashed=FALSE
                    LEFT JOIN student_attendance sa ON sa.enrollment_id=ce.id AND sa.schedule_slot_id=ses.slot_id AND sa.session_date=ses.session_date AND sa.is_trashed=FALSE
                    GROUP BY ses.slot_id,ses.session_date,s.id
                ),
                counts AS (
                    SELECT slot_id,session_date,
                           COUNT(DISTINCT student_id) FILTER (WHERE is_current_roster OR eligible_for_date OR has_saved_attendance) AS total_students,
                           COUNT(DISTINCT student_id) FILTER (WHERE is_present) AS present_students
                    FROM per_student GROUP BY slot_id,session_date
                )
                SELECT ses.slot_id,ses.session_date,COALESCE(counts.total_students,0),COALESCE(counts.present_students,0)
                FROM sessions ses LEFT JOIN counts ON counts.slot_id=ses.slot_id AND counts.session_date=ses.session_date
                ORDER BY ses.session_date DESC,ses.slot_id;
                """);
            cmd.Parameters.AddWithValue("from", from); cmd.Parameters.AddWithValue("to", from.AddMonths(1));
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(new { scheduleSlotId=reader.GetGuid(0), sessionDate=reader.GetFieldValue<DateOnly>(1), totalStudents=reader.GetInt64(2), presentStudents=reader.GetInt64(3) });
            return Results.Ok(rows);
        }).RequireAuthorization("attendance.access");

        app.MapGet("/api/student-attendance", async Task<IResult> (string? month, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!TryMonth(month, out var from)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
            var rows = new List<object>();
            await using var cmd = db.CreateCommand("""
                SELECT sa.id,sa.schedule_slot_id,ce.id,s.id,s.student_code,s.full_name,c.id,c.name,
                       c.teacher_id,COALESCE(t.full_name,''),sa.session_date,ss.starts_at,sa.status,sa.note,sa.marked_at
                FROM student_attendance sa JOIN circle_enrollments ce ON ce.id=sa.enrollment_id
                JOIN students s ON s.id=ce.student_id JOIN circles c ON c.id=ce.circle_id
                JOIN circle_schedule_slots ss ON ss.id=sa.schedule_slot_id LEFT JOIN teachers t ON t.id=c.teacher_id
                WHERE sa.session_date>=@from AND sa.session_date<@to AND sa.is_trashed=FALSE
                  AND ce.is_trashed=FALSE AND s.is_trashed=FALSE AND c.is_trashed=FALSE
                ORDER BY sa.session_date DESC,ss.starts_at DESC,c.name,s.full_name;
                """);
            cmd.Parameters.AddWithValue("from", from); cmd.Parameters.AddWithValue("to", from.AddMonths(1));
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(new { id=reader.GetGuid(0), scheduleSlotId=reader.GetGuid(1), enrollmentId=reader.GetGuid(2), studentId=reader.GetGuid(3), studentCode=reader.GetString(4), studentName=reader.GetString(5), circleId=reader.GetGuid(6), circleName=reader.GetString(7), teacherId=reader.IsDBNull(8)?(Guid?)null:reader.GetGuid(8), teacherName=reader.GetString(9), sessionDate=reader.GetFieldValue<DateOnly>(10), startsAt=reader.GetFieldValue<TimeOnly>(11).ToString("HH:mm"), status=reader.GetString(12), note=reader.IsDBNull(13)?null:reader.GetString(13), markedAt=reader.GetFieldValue<DateTimeOffset>(14) });
            return Results.Ok(rows);
        }).RequireAuthorization("attendance.access");

        app.MapPost("/api/student-attendance", async Task<IResult> (StudentAttendanceMarkRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (request.ScheduleSlotId==Guid.Empty || request.EnrollmentId==Guid.Empty || request.SessionDate==default || request.SessionDate>DateOnly.FromDateTime(DateTime.Today) || !new[] { "present", "absent", "excused" }.Contains(request.Status, StringComparer.Ordinal))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["attendance"] = ["حدد الحصة والطالب وتاريخًا مسجلًا اليوم أو قبله وحالة حضور صحيحة."] });
            await using var conn=await db.OpenConnectionAsync(ct); await using var tx=await conn.BeginTransactionAsync(ct);
            string? before=null; Guid? existingId=null;
            // Lock the student row so two enrollment records for the same student cannot create parallel attendance rows for one lesson.
            await using (var studentLock=new NpgsqlCommand("SELECT s.id FROM students s JOIN circle_enrollments ce ON ce.student_id=s.id WHERE ce.id=@enrollment AND s.is_trashed=FALSE FOR UPDATE OF s;",conn,tx))
            { studentLock.Parameters.AddWithValue("enrollment",request.EnrollmentId); if(await studentLock.ExecuteScalarAsync(ct) is not Guid) return Results.NotFound(new{message="ملف الطالب أو الالتحاق غير موجود."}); }
            await using (var validate=new NpgsqlCommand("""
                SELECT EXISTS(
                  SELECT 1
                  FROM circle_schedule_slots ss
                  JOIN circle_enrollments ce ON ce.circle_id=ss.circle_id
                  JOIN circles attendance_circle ON attendance_circle.id=ss.circle_id AND attendance_circle.is_trashed=FALSE
                  JOIN students s ON s.id=ce.student_id
                  WHERE ss.id=@slot AND ss.is_trashed=FALSE AND ce.id=@enrollment AND ce.is_trashed=FALSE AND s.is_trashed=FALSE
                    AND public.dar_enrollment_is_attendance_eligible_on_date(ce.id,@date)
                    AND attendance_circle.starts_on<=@date
                    AND (ce.ends_on IS NULL OR @date<=ce.ends_on)
                    AND (@allowHistorical=TRUE OR ce.starts_on<=@date)
                );
                """,conn,tx))
            { validate.Parameters.AddWithValue("slot",request.ScheduleSlotId);validate.Parameters.AddWithValue("enrollment",request.EnrollmentId);validate.Parameters.AddWithValue("date",request.SessionDate);validate.Parameters.AddWithValue("allowHistorical",request.AllowHistoricalEntry);if(!(bool)(await validate.ExecuteScalarAsync(ct)??false))return Results.Conflict(new{message="الطالب غير مسجل في هذه الحلقة في تاريخ الحصة، أو أن الموعد غير متاح."}); }
            await using (var existing=new NpgsqlCommand("""
                SELECT sa.id,to_jsonb(sa)::text FROM student_attendance sa
                JOIN circle_enrollments existing_enrollment ON existing_enrollment.id=sa.enrollment_id
                JOIN circle_enrollments requested_enrollment ON requested_enrollment.id=@enrollment
                WHERE sa.schedule_slot_id=@slot AND sa.session_date=@date AND sa.is_trashed=FALSE
                  AND existing_enrollment.student_id=requested_enrollment.student_id
                ORDER BY (sa.enrollment_id=@enrollment) DESC,sa.marked_at DESC,sa.id DESC LIMIT 1 FOR UPDATE OF sa;
                """,conn,tx))
            { existing.Parameters.AddWithValue("slot",request.ScheduleSlotId); existing.Parameters.AddWithValue("enrollment",request.EnrollmentId); existing.Parameters.AddWithValue("date",request.SessionDate); await using var existingReader=await existing.ExecuteReaderAsync(ct); if(await existingReader.ReadAsync(ct)){existingId=existingReader.GetGuid(0);before=existingReader.GetString(1);} }
            Guid id;
            if(existingId.HasValue)
            {
                await using var update=new NpgsqlCommand("UPDATE student_attendance SET enrollment_id=@enrollment,status=@status,note=@note,marked_by=@actor,marked_at=now() WHERE id=@id RETURNING id;",conn,tx);
                update.Parameters.AddWithValue("id",existingId.Value);update.Parameters.AddWithValue("enrollment",request.EnrollmentId);update.Parameters.AddWithValue("status",request.Status);update.Parameters.AddWithValue("note",(object?)request.Note?.Trim()??DBNull.Value);update.Parameters.AddWithValue("actor",ActorId(principal));id=(Guid)(await update.ExecuteScalarAsync(ct)??throw new InvalidOperationException("لم يتم تحديث الحضور."));
            }
            else
            {
                await using var save=new NpgsqlCommand("""
                    INSERT INTO student_attendance(schedule_slot_id,enrollment_id,session_date,status,note,marked_by,is_trashed)
                    VALUES(@slot,@enrollment,@date,@status,@note,@actor,FALSE) RETURNING id;
                    """,conn,tx);
                save.Parameters.AddWithValue("slot",request.ScheduleSlotId);save.Parameters.AddWithValue("enrollment",request.EnrollmentId);save.Parameters.AddWithValue("date",request.SessionDate);save.Parameters.AddWithValue("status",request.Status);save.Parameters.AddWithValue("note",(object?)request.Note?.Trim()??DBNull.Value);save.Parameters.AddWithValue("actor",ActorId(principal));id=(Guid)(await save.ExecuteScalarAsync(ct)??throw new InvalidOperationException("لم يتم حفظ الحضور."));
            }
            string? after;await using(var snap=new NpgsqlCommand("SELECT to_jsonb(sa)::text FROM student_attendance sa WHERE id=@id;",conn,tx)){snap.Parameters.AddWithValue("id",id);after=(string?)await snap.ExecuteScalarAsync(ct);}
            await using(var audit=new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,actor_display_name,action_code,entity_type,entity_id,details,before_data,after_data,request_path,http_method,can_restore) VALUES(@actor,@name,@action,'student_attendance',@id,jsonb_build_object('status',@status,'sessionDate',@date,'historicalOverride',@allowHistorical),@before::jsonb,@after::jsonb,'/api/student-attendance','POST',FALSE);",conn,tx))
            {audit.Parameters.AddWithValue("actor",ActorId(principal));audit.Parameters.AddWithValue("name",principal.FindFirstValue("display_name")??"حساب غير معروف");audit.Parameters.AddWithValue("action",before is null?"student.attendance.create":"student.attendance.update");audit.Parameters.AddWithValue("id",id);audit.Parameters.AddWithValue("status",request.Status);audit.Parameters.AddWithValue("date",request.SessionDate);audit.Parameters.AddWithValue("allowHistorical",request.AllowHistoricalEntry);audit.Parameters.AddWithValue("before",(object?)before??DBNull.Value);audit.Parameters.AddWithValue("after",(object?)after??DBNull.Value);await audit.ExecuteNonQueryAsync(ct);}
            await tx.CommitAsync(ct);return Results.Ok(new{id,status=request.Status,sessionDate=request.SessionDate,enrollmentId=request.EnrollmentId,scheduleSlotId=request.ScheduleSlotId});
        }).RequireAuthorization("attendance.edit");

        app.MapPost("/api/teacher-attendance", async Task<IResult> (TeacherAttendanceMarkRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (request.ScheduleSlotId == Guid.Empty || request.SessionDate == default || !new[] { "present", "absent", "cancelled" }.Contains(request.Status, StringComparer.Ordinal))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["attendance"] = ["حدد الحصة وتاريخها والحالة الصحيحة للحضور."] });
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            Guid circleId; Guid? assignedTeacherId; string assignedTeacherName; TimeOnly startsAt; int duration;
            await using (var info = new NpgsqlCommand("""
                SELECT ss.circle_id,c.teacher_id,COALESCE(t.full_name,''),ss.starts_at,ss.duration_minutes
                FROM circle_schedule_slots ss JOIN circles c ON c.id=ss.circle_id
                LEFT JOIN teachers t ON t.id=c.teacher_id
                WHERE ss.id=@id AND ss.is_trashed=FALSE AND ss.is_active=TRUE AND c.is_trashed=FALSE AND c.is_active=TRUE
                FOR UPDATE OF ss;
                """, conn, tx))
            {
                info.Parameters.AddWithValue("id", request.ScheduleSlotId); await using var reader = await info.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct)) return Results.NotFound(new { message = "موعد الحلقة غير موجود أو متوقف." });
                circleId = reader.GetGuid(0); assignedTeacherId = reader.IsDBNull(1) ? null : reader.GetGuid(1); assignedTeacherName = reader.GetString(2); startsAt = reader.GetFieldValue<TimeOnly>(3); duration = reader.GetInt32(4);
            }
            var teacherId = request.TeacherId ?? assignedTeacherId;
            if (!teacherId.HasValue) return Results.Conflict(new { message = "لا توجد معلمة مسندة للحلقة؛ اختر معلمة لهذه الحصة أولًا." });
            string selectedTeacherName; decimal hourlyRate;
            await using (var teacher = new NpgsqlCommand("SELECT full_name,hourly_rate FROM teachers WHERE id=@id AND is_trashed=FALSE AND status='active';", conn, tx))
            {
                teacher.Parameters.AddWithValue("id", teacherId.Value); await using var reader = await teacher.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct)) return Results.Conflict(new { message = "المعلمة المختارة غير نشطة أو غير موجودة." });
                selectedTeacherName = reader.GetString(0); hourlyRate = reader.GetDecimal(1);
            }
            var isSubstitute = assignedTeacherId.HasValue && teacherId.Value != assignedTeacherId.Value;
            var note = isSubstitute ? $"بديلة عن {assignedTeacherName}" + (string.IsNullOrWhiteSpace(request.Note) ? string.Empty : $" · {request.Note.Trim()}") : request.Note?.Trim();
            var effectiveHourlyRate = hourlyRate;
            await using (var existing = new NpgsqlCommand("SELECT teacher_id,hourly_rate_snapshot FROM teacher_attendance WHERE schedule_slot_id=@slot AND session_date=@date FOR UPDATE;", conn, tx))
            {
                existing.Parameters.AddWithValue("slot", request.ScheduleSlotId); existing.Parameters.AddWithValue("date", request.SessionDate);
                await using var reader = await existing.ExecuteReaderAsync(ct);
                if (await reader.ReadAsync(ct) && reader.GetGuid(0) == teacherId.Value)
                    effectiveHourlyRate = reader.GetDecimal(1);
            }
            decimal payable = 0m;
            if (request.Status == "present" && !MoneyRules.TryCalculateTeacherPayableAmount(effectiveHourlyRate, duration, out payable))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["teacherId"] = ["المستحق المحسوب من Snapshot أجر الساعة لهذه الحصة يتجاوز الحد المالي المسموح."] });
            await using var cmd = new NpgsqlCommand("""
                INSERT INTO teacher_attendance(schedule_slot_id,circle_id,teacher_id,session_date,scheduled_start,duration_minutes,status,hourly_rate_snapshot,payable_amount,note,marked_by)
                VALUES(@slot,@circle,@teacher,@date,@start,@duration,@status,@rate,@payable,@note,@actor)
                ON CONFLICT(schedule_slot_id,session_date) DO UPDATE SET
                    teacher_id=EXCLUDED.teacher_id,
                    hourly_rate_snapshot=CASE
                        WHEN teacher_attendance.teacher_id IS DISTINCT FROM EXCLUDED.teacher_id THEN EXCLUDED.hourly_rate_snapshot
                        ELSE teacher_attendance.hourly_rate_snapshot
                    END,
                    scheduled_start=EXCLUDED.scheduled_start,duration_minutes=EXCLUDED.duration_minutes,status=EXCLUDED.status,note=EXCLUDED.note,
                    marked_by=EXCLUDED.marked_by,marked_at=now(),
                    payable_amount=CASE WHEN EXCLUDED.status='present' THEN
                        EXCLUDED.duration_minutes * CASE
                            WHEN teacher_attendance.teacher_id IS DISTINCT FROM EXCLUDED.teacher_id THEN EXCLUDED.hourly_rate_snapshot
                            ELSE teacher_attendance.hourly_rate_snapshot
                        END / 60.0
                    ELSE 0 END
                RETURNING id,payable_amount,hourly_rate_snapshot;
                """, conn, tx);
            cmd.Parameters.AddWithValue("slot", request.ScheduleSlotId); cmd.Parameters.AddWithValue("circle", circleId); cmd.Parameters.AddWithValue("teacher", teacherId.Value);
            cmd.Parameters.AddWithValue("date", request.SessionDate); cmd.Parameters.AddWithValue("start", startsAt); cmd.Parameters.AddWithValue("duration", duration);
            cmd.Parameters.AddWithValue("status", request.Status); cmd.Parameters.AddWithValue("rate", hourlyRate); cmd.Parameters.AddWithValue("payable", payable); AddNullable(cmd, "note", note); cmd.Parameters.AddWithValue("actor", ActorId(principal));
            Guid savedId; decimal savedPayable; decimal savedRate;
            await using (var saved = await cmd.ExecuteReaderAsync(ct))
            {
                if (!await saved.ReadAsync(ct)) throw new InvalidOperationException("لم يتم حفظ سجل حضور المعلمة.");
                savedId = saved.GetGuid(0); savedPayable = saved.GetDecimal(1); savedRate = saved.GetDecimal(2);
            }
            await tx.CommitAsync(ct);
            return Results.Ok(new { id = savedId, payableAmount = CanReadFinance(principal) ? savedPayable : (decimal?)null, hourlyRateSnapshot = CanReadFinance(principal) ? savedRate : (decimal?)null, teacherId = teacherId.Value, teacherName = selectedTeacherName, isSubstitute, request.Status, request.SessionDate, request.ScheduleSlotId });
        }).RequireAuthorization("attendance.edit");
    }

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

        app.MapDelete("/api/operating-expenses/{id:guid}", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var conn = await db.OpenConnectionAsync(ct); await using var tx = await conn.BeginTransactionAsync(ct);
            DateOnly expenseDate; string category, description; decimal amount;
            await using (var delete = new NpgsqlCommand("DELETE FROM operating_expenses WHERE id=@id RETURNING expense_date,category,description,amount;", conn, tx))
            {
                delete.Parameters.AddWithValue("id", id); await using var reader = await delete.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct)) return Results.NotFound(new { message = "المصروف غير موجود." });
                expenseDate = reader.GetFieldValue<DateOnly>(0); category = reader.GetString(1); description = reader.GetString(2); amount = reader.GetDecimal(3);
            }
            await using (var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'operating_expense.delete','operating_expense',@id,jsonb_build_object('category',@category,'description',@description,'amount',@amount,'expenseDate',@date));", conn, tx))
            {
                audit.Parameters.AddWithValue("actor", ActorId(principal)); audit.Parameters.AddWithValue("id", id); audit.Parameters.AddWithValue("category", category);
                audit.Parameters.AddWithValue("description", description); audit.Parameters.AddWithValue("amount", amount); audit.Parameters.AddWithValue("date", expenseDate); await audit.ExecuteNonQueryAsync(ct);
            }
            await tx.CommitAsync(ct); return Results.Ok(new { id, deleted = true });
        }).RequireAuthorization("finance.delete");
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
                  AND NOT EXISTS(SELECT 1 FROM monthly_charges existing_charge WHERE existing_charge.enrollment_id=ce.id AND existing_charge.billing_month=@month AND existing_charge.is_trashed=FALSE)
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
                WHERE mc.billing_month=@month AND mc.is_trashed=FALSE AND ce.is_trashed=FALSE
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
        }).RequireAuthorization("finance.create");

        app.MapDelete("/api/charges/{id:guid}", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            decimal due, paid;
            await using (var check = new NpgsqlCommand("SELECT amount_due,COALESCE((SELECT SUM(amount) FROM payments WHERE monthly_charge_id=mc.id AND is_trashed=FALSE),0) FROM monthly_charges mc WHERE id=@id AND is_trashed=FALSE FOR UPDATE;", conn, tx))
            {
                check.Parameters.AddWithValue("id", id);
                await using var reader = await check.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct)) return Results.NotFound();
                due = reader.GetDecimal(0); paid = reader.GetDecimal(1);
            }
            await using (var delete = new NpgsqlCommand("DELETE FROM monthly_charges WHERE id=@id;", conn, tx))
            {
                delete.Parameters.AddWithValue("id", id);
                await delete.ExecuteNonQueryAsync(ct);
            }
            await using (var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'charge.delete','monthly_charge',@id,jsonb_build_object('amountDue',@due,'amountPaid',@paid));", conn, tx))
            {
                audit.Parameters.AddWithValue("actor", ActorId(principal)); audit.Parameters.AddWithValue("id", id); audit.Parameters.AddWithValue("due", due); audit.Parameters.AddWithValue("paid", paid);
                await audit.ExecuteNonQueryAsync(ct);
            }
            await tx.CommitAsync(ct);
            return Results.Ok(new { id, deleted = true, message = "تم حذف الاستحقاق والدفعات المرتبطة به." });
        }).RequireAuthorization("finance.delete");

        app.MapPut("/api/charges/{id:guid}", async Task<IResult> (Guid id, ChargeUpdateRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!MoneyRules.TryNormalizeNonNegativeCurrency(request.AmountDue, out var amountDue))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["amountDue"] = ["المبلغ يتجاوز الحد المسموح أو لا يمكن تمثيله بدقة منزلتين عشريتين."] });
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            decimal paid;
            await using (var check = new NpgsqlCommand("SELECT id FROM monthly_charges WHERE id=@id AND is_trashed=FALSE FOR UPDATE;", conn, tx))
            {
                check.Parameters.AddWithValue("id", id);
                var value = await check.ExecuteScalarAsync(ct);
                if (value is null) return Results.NotFound(new { message = "الاستحقاق غير موجود." });
            }
            await using (var sum = new NpgsqlCommand("SELECT COALESCE(SUM(amount),0) FROM payments WHERE monthly_charge_id=@id AND is_trashed=FALSE;", conn, tx))
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
        }).RequireAuthorization("finance.edit", "finance.read");

        app.MapPost("/api/payments",async Task<IResult> (PaymentWriteRequest request,ClaimsPrincipal principal,NpgsqlDataSource db,CancellationToken ct)=>
        {
            if (request.MonthlyChargeId == Guid.Empty)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["amount"] = ["حدد الاستحقاق واكتب مبلغًا صحيحًا أكبر من صفر وبحد أقصى 9,999,999,999.99 ج.م."] });
            if (!MoneyRules.TryNormalizePaymentAmount(request.Amount, out var paymentAmount))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["amount"] = ["حدد الاستحقاق واكتب مبلغًا صحيحًا أكبر من صفر وبحد أقصى 9,999,999,999.99 ج.م."] });
            await using var conn=await db.OpenConnectionAsync(ct);await using var tx=await conn.BeginTransactionAsync(ct);
            decimal due,paid;
            await using(var check=new NpgsqlCommand("SELECT amount_due FROM monthly_charges WHERE id=@id AND is_trashed=FALSE FOR UPDATE;",conn,tx))
            {
                check.Parameters.AddWithValue("id",request.MonthlyChargeId);var value=await check.ExecuteScalarAsync(ct);
                if(value is null)return Results.NotFound(new{message="الاستحقاق غير موجود."});due=Convert.ToDecimal(value,System.Globalization.CultureInfo.InvariantCulture);
            }
            await using(var sum=new NpgsqlCommand("SELECT COALESCE(SUM(amount),0) FROM payments WHERE monthly_charge_id=@id AND is_trashed=FALSE;",conn,tx))
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
        }).RequireAuthorization("finance.create");

        app.MapPost("/api/payments/with-receipt", async Task<IResult> (HttpRequest httpRequest, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!httpRequest.HasFormContentType) return Results.BadRequest(new { message = "ارفع الإيصال مع بيانات التحصيل في نموذج متعدد الأجزاء." });
            var form = await httpRequest.ReadFormAsync(ct);
            if (!Guid.TryParse(form["monthlyChargeId"], out var chargeId) || chargeId == Guid.Empty)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["payment"] = ["حدد الاستحقاق ومبلغًا صحيحًا أكبر من صفر وبحد أقصى 9,999,999,999.99 ج.م."] });
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
            await using (var check = new NpgsqlCommand("SELECT amount_due FROM monthly_charges WHERE id=@id AND is_trashed=FALSE FOR UPDATE;", conn, tx))
            { check.Parameters.AddWithValue("id", chargeId); var value = await check.ExecuteScalarAsync(ct); if (value is null) return Results.NotFound(new { message = "الاستحقاق غير موجود." }); due = Convert.ToDecimal(value, System.Globalization.CultureInfo.InvariantCulture); }
            decimal paid;
            await using (var sum = new NpgsqlCommand("SELECT COALESCE(SUM(amount),0) FROM payments WHERE monthly_charge_id=@id AND is_trashed=FALSE;", conn, tx))
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
        }).RequireAuthorization("finance.create");

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

        app.MapDelete("/api/payments/{id:guid}",async Task<IResult> (Guid id,ClaimsPrincipal principal,NpgsqlDataSource db,CancellationToken ct)=>
        {
            await using var conn=await db.OpenConnectionAsync(ct);await using var tx=await conn.BeginTransactionAsync(ct);
            decimal amount;Guid charge;
            await using(var del=new NpgsqlCommand("DELETE FROM payments WHERE id=@id RETURNING monthly_charge_id,amount;",conn,tx))
            {
                del.Parameters.AddWithValue("id",id);await using var reader=await del.ExecuteReaderAsync(ct);
                if(!await reader.ReadAsync(ct))return Results.NotFound();charge=reader.GetGuid(0);amount=reader.GetDecimal(1);
            }
            await using(var audit=new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'payment.delete','payment',@id,jsonb_build_object('chargeId',@charge,'amount',@amount));",conn,tx))
            {audit.Parameters.AddWithValue("actor",ActorId(principal));audit.Parameters.AddWithValue("id",id);audit.Parameters.AddWithValue("charge",charge);audit.Parameters.AddWithValue("amount",amount);await audit.ExecuteNonQueryAsync(ct);}
            await tx.CommitAsync(ct);return Results.Ok(new{id,deleted=true});
        }).RequireAuthorization("finance.delete");
    }

    private static async Task<StudentResponse?> LoadStudent(NpgsqlDataSource db,Guid id,bool financeVisible,CancellationToken ct)
    {
        await using var cmd=db.CreateCommand(StudentProjection+" WHERE s.id=@id AND s.is_trashed=FALSE;");cmd.Parameters.AddWithValue("id",id);await using var reader=await cmd.ExecuteReaderAsync(ct);return await reader.ReadAsync(ct)?ReadStudent(reader,financeVisible):null;
    }

    private static async Task<TeacherResponse?> LoadTeacher(NpgsqlDataSource db,Guid id,bool financeVisible,CancellationToken ct)
    {
        await using var cmd=db.CreateCommand("""
          SELECT t.id,t.teacher_code,t.full_name,t.phone,t.hourly_rate,t.status,t.notes,t.created_at,t.updated_at,
              COALESCE((SELECT string_agg(c.name,'، ' ORDER BY c.name) FROM circles c WHERE c.teacher_id=t.id AND c.is_trashed=FALSE), ''),
              (SELECT COUNT(*) FROM circles c WHERE c.teacher_id=t.id AND c.is_trashed=FALSE)
          FROM teachers t WHERE t.id=@id AND t.is_trashed=FALSE;
          """);cmd.Parameters.AddWithValue("id",id);await using var reader=await cmd.ExecuteReaderAsync(ct);return await reader.ReadAsync(ct)?ReadTeacher(reader,financeVisible):null;
    }

    private static async Task<CircleResponse?> LoadCircle(NpgsqlDataSource db,Guid id,bool financeVisible,CancellationToken ct)
    {
        await using var cmd=db.CreateCommand("SELECT c.id,c.circle_code,c.name,c.teacher_id,COALESCE(t.full_name,''),c.monthly_fee,c.schedule_text,c.is_active,c.created_at,c.updated_at,(SELECT COUNT(*) FROM circle_enrollments ce WHERE ce.circle_id=c.id AND ce.status='active' AND ce.is_trashed=FALSE),c.starts_on FROM circles c LEFT JOIN teachers t ON t.id=c.teacher_id WHERE c.id=@id AND c.is_trashed=FALSE;");
        cmd.Parameters.AddWithValue("id",id);await using var reader=await cmd.ExecuteReaderAsync(ct);return await reader.ReadAsync(ct)?ReadCircle(reader,financeVisible):null;
    }

    private static async Task<IResult> TeacherHistory(NpgsqlDataSource db, Guid id, ClaimsPrincipal principal, CancellationToken ct)
    {
        var financeVisible = CanReadFinance(principal);
        var teacher = await LoadTeacher(db, id, financeVisible, ct);
        if (teacher is null) return Results.NotFound();

        var circlesVisible = principal.HasClaim("permission", "circles.read");
        var attendanceVisible = principal.HasClaim("permission", "attendance.read") || principal.HasClaim("permission", "attendance.edit");
        var circles = new List<object>();
        var scheduleSlots = new List<object>();
        var attendance = new List<object>();
        var notes = new List<StudentNoteResponse>();
        await using (var notesCmd = db.CreateCommand("SELECT n.id,n.note_text,n.created_at,COALESCE(u.display_name,'') FROM teacher_notes n LEFT JOIN app_users u ON u.id=n.created_by WHERE n.teacher_id=@teacher AND n.is_trashed=FALSE ORDER BY n.created_at DESC;"))
        {
            notesCmd.Parameters.AddWithValue("teacher", id);
            await using var notesReader = await notesCmd.ExecuteReaderAsync(ct);
            while (await notesReader.ReadAsync(ct)) notes.Add(new StudentNoteResponse(notesReader.GetGuid(0), notesReader.GetString(1), notesReader.GetFieldValue<DateTimeOffset>(2), notesReader.GetString(3)));
        }
        object? totals = null;

        if (circlesVisible)
        {
            await using var cmd = db.CreateCommand("""
                SELECT c.id,c.circle_code,c.name,c.monthly_fee,c.is_active,
                       (SELECT COUNT(*) FROM circle_enrollments ce WHERE ce.circle_id=c.id AND ce.status='active' AND ce.is_trashed=FALSE) AS active_student_count
                FROM circles c WHERE c.teacher_id=@teacher AND c.is_trashed=FALSE ORDER BY c.is_active DESC,c.name;
                """);
            cmd.Parameters.AddWithValue("teacher", id);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) circles.Add(new
            {
                id = reader.GetGuid(0), circleCode = reader.GetString(1), name = reader.GetString(2),
                monthlyFee = financeVisible ? reader.GetDecimal(3) : (decimal?)null, isActive = reader.GetBoolean(4), activeStudentCount = reader.GetInt64(5)
            });

            await using var slotsCmd = db.CreateCommand("""
                SELECT ss.id,ss.circle_id,c.name,ss.day_of_week,ss.starts_at,ss.duration_minutes,ss.is_active
                FROM circle_schedule_slots ss JOIN circles c ON c.id=ss.circle_id
                WHERE c.teacher_id=@teacher AND c.is_trashed=FALSE AND ss.is_trashed=FALSE
                ORDER BY ss.is_active DESC,ss.day_of_week,ss.starts_at;
                """);
            slotsCmd.Parameters.AddWithValue("teacher", id);
            await using var slotsReader = await slotsCmd.ExecuteReaderAsync(ct);
            while (await slotsReader.ReadAsync(ct)) scheduleSlots.Add(new
            {
                id = slotsReader.GetGuid(0), circleId = slotsReader.GetGuid(1), circleName = slotsReader.GetString(2),
                dayOfWeek = (int)slotsReader.GetInt16(3), startsAt = slotsReader.GetFieldValue<TimeOnly>(4).ToString("HH:mm"),
                durationMinutes = slotsReader.GetInt32(5), isActive = slotsReader.GetBoolean(6)
            });
        }

        if (attendanceVisible)
        {
            await using var cmd = db.CreateCommand("""
                SELECT a.id,a.session_date,COALESCE(c.name,'حلقة غير متاحة'),a.scheduled_start,a.duration_minutes,a.status,
                       a.hourly_rate_snapshot,a.payable_amount,a.note,a.marked_at,
                       CASE WHEN a.status='present' THEN (SELECT COUNT(DISTINCT ce.student_id) FROM student_attendance sa JOIN circle_enrollments ce ON ce.id=sa.enrollment_id WHERE sa.schedule_slot_id=a.schedule_slot_id
                          AND sa.session_date=a.session_date AND sa.status='present' AND sa.is_trashed=FALSE AND ce.is_trashed=FALSE) ELSE 0 END AS present_students_count, a.schedule_slot_id
                FROM teacher_attendance a LEFT JOIN circles c ON c.id=a.circle_id
                WHERE a.teacher_id=@teacher AND a.is_trashed=FALSE
                ORDER BY a.session_date DESC,a.scheduled_start DESC LIMIT 100;
                """);
            cmd.Parameters.AddWithValue("teacher", id);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) attendance.Add(new
            {
                id = reader.GetGuid(0), sessionDate = reader.GetFieldValue<DateOnly>(1), circleName = reader.GetString(2),
                startsAt = reader.GetFieldValue<TimeOnly>(3).ToString("HH:mm"), durationMinutes = reader.GetInt32(4), status = reader.GetString(5),
                hourlyRateSnapshot = financeVisible ? reader.GetDecimal(6) : (decimal?)null, payableAmount = financeVisible ? reader.GetDecimal(7) : (decimal?)null, note = reader.IsDBNull(8) ? null : reader.GetString(8),
                markedAt = reader.GetFieldValue<DateTimeOffset>(9), presentStudentsCount = reader.GetInt64(10), scheduleSlotId = reader.IsDBNull(11) ? (Guid?)null : reader.GetGuid(11)
            });

            await using var totalsCmd = db.CreateCommand("""
                SELECT COUNT(*) FILTER (WHERE status='present'),
                       COALESCE(SUM(duration_minutes) FILTER (WHERE status='present'),0),
                       COALESCE(SUM(payable_amount) FILTER (WHERE status='present'),0)
                FROM teacher_attendance WHERE teacher_id=@teacher AND is_trashed=FALSE;
                """);
            totalsCmd.Parameters.AddWithValue("teacher", id);
            await using var totalsReader = await totalsCmd.ExecuteReaderAsync(ct);
            if (await totalsReader.ReadAsync(ct)) totals = new
            {
                presentSessions = totalsReader.GetInt64(0),
                totalHours = totalsReader.GetInt64(1) / 60m,
                payableTotal = financeVisible ? totalsReader.GetDecimal(2) : (decimal?)null
            };
        }

        return Results.Ok(new { teacher, circles, scheduleSlots, attendance, notes, attendanceVisible, circlesVisible, financeVisible, attendanceLimit = 100, totals });
    }

    private static async Task<IResult> StudentHistory(NpgsqlDataSource db,Guid id,ClaimsPrincipal principal,CancellationToken ct)
    {
        var financeVisible = CanReadFinance(principal);
        var student=await LoadStudent(db,id,financeVisible,ct);if(student is null)return Results.NotFound();
        var enrollments=new List<object>();
        await using(var cmd=db.CreateCommand("""
          SELECT ce.id,ce.circle_id,c.name,COALESCE(t.full_name,''),ce.starts_on,ce.ends_on,ce.agreed_monthly_fee,ce.status
          FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id LEFT JOIN teachers t ON t.id=c.teacher_id
          WHERE ce.student_id=@id AND ce.is_trashed=FALSE ORDER BY ce.starts_on DESC;
          """))
        {cmd.Parameters.AddWithValue("id",id);await using var reader=await cmd.ExecuteReaderAsync(ct);while(await reader.ReadAsync(ct))enrollments.Add(new{id=reader.GetGuid(0),circleId=reader.GetGuid(1),circleName=reader.GetString(2),teacherName=reader.GetString(3),startsOn=reader.GetFieldValue<DateOnly>(4),endsOn=reader.IsDBNull(5)?(DateOnly?)null:reader.GetFieldValue<DateOnly>(5),agreedMonthlyFee=financeVisible ? reader.GetDecimal(6) : (decimal?)null,status=reader.GetString(7)});}
        var charges=new Dictionary<Guid,ChargeHistoryBuilder>();
        if (financeVisible)
        {
            await using(var cmd=db.CreateCommand("""
              SELECT mc.id,mc.billing_month,mc.amount_due,mc.note,c.name,p.id,p.amount,p.paid_at,p.method,p.reference,p.note,(p.receipt_data IS NOT NULL)
              FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id JOIN monthly_charges mc ON mc.enrollment_id=ce.id
              LEFT JOIN payments p ON p.monthly_charge_id=mc.id AND p.is_trashed=FALSE WHERE ce.student_id=@id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE
              ORDER BY mc.billing_month DESC,p.paid_at DESC;
              """))
            {cmd.Parameters.AddWithValue("id",id);await using var reader=await cmd.ExecuteReaderAsync(ct);while(await reader.ReadAsync(ct)){
                var chargeId=reader.GetGuid(0);if(!charges.TryGetValue(chargeId,out var charge)){charge=new ChargeHistoryBuilder(chargeId,reader.GetFieldValue<DateOnly>(1),reader.GetDecimal(2),reader.IsDBNull(3)?null:reader.GetString(3),reader.GetString(4));charges.Add(chargeId,charge);}
                if(!reader.IsDBNull(5))charge.Payments.Add(new PaymentHistory(reader.GetGuid(5),reader.GetDecimal(6),reader.GetFieldValue<DateTimeOffset>(7),reader.IsDBNull(8)?null:reader.GetString(8),reader.IsDBNull(9)?null:reader.GetString(9),reader.IsDBNull(10)?null:reader.GetString(10),reader.GetBoolean(11)));
              }}
        }
        var notes=new List<StudentNoteResponse>();
        await using(var cmd=db.CreateCommand("SELECT n.id,n.note_text,n.created_at,COALESCE(u.display_name,'') FROM student_notes n LEFT JOIN app_users u ON u.id=n.created_by WHERE n.student_id=@id AND n.is_trashed=FALSE ORDER BY n.created_at DESC;"))
        {cmd.Parameters.AddWithValue("id",id);await using var reader=await cmd.ExecuteReaderAsync(ct);while(await reader.ReadAsync(ct))notes.Add(new StudentNoteResponse(reader.GetGuid(0),reader.GetString(1),reader.GetFieldValue<DateTimeOffset>(2),reader.GetString(3)));}
        var attendanceVisible = principal.HasClaim("permission", "attendance.read") || principal.HasClaim("permission", "attendance.edit");
        var attendance = new List<object>();
        if (attendanceVisible)
        {
            await using var cmd = db.CreateCommand("""
                WITH ranked_attendance AS (
                    SELECT sa.id,sa.session_date,c.name AS circle_name,ss.starts_at,sa.status,COALESCE(t.full_name,'') AS teacher_name,sa.note,sa.marked_at,
                           ROW_NUMBER() OVER(PARTITION BY ce.student_id,sa.schedule_slot_id,sa.session_date ORDER BY sa.marked_at DESC,sa.id DESC) AS student_session_row
                    FROM student_attendance sa
                    JOIN circle_enrollments ce ON ce.id=sa.enrollment_id
                    JOIN circles c ON c.id=ce.circle_id
                    JOIN circle_schedule_slots ss ON ss.id=sa.schedule_slot_id
                    LEFT JOIN teachers t ON t.id=c.teacher_id
                    WHERE ce.student_id=@id AND sa.is_trashed=FALSE AND ce.is_trashed=FALSE AND c.is_trashed=FALSE
                )
                SELECT id,session_date,circle_name,starts_at,status,teacher_name,note,marked_at
                FROM ranked_attendance WHERE student_session_row=1
                ORDER BY session_date DESC,starts_at DESC,marked_at DESC;
                """);
            cmd.Parameters.AddWithValue("id", id);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) attendance.Add(new
            {
                id = reader.GetGuid(0), sessionDate = reader.GetFieldValue<DateOnly>(1), circleName = reader.GetString(2),
                startsAt = reader.GetFieldValue<TimeOnly>(3).ToString("HH:mm"), status = reader.GetString(4), teacherName = reader.GetString(5),
                note = reader.IsDBNull(6) ? null : reader.GetString(6), markedAt = reader.GetFieldValue<DateTimeOffset>(7)
            });
        }
        return Results.Ok(new {student,enrollments,charges=charges.Values.Select(c=>c.ToResponse()),notes,attendance,attendanceVisible,financeVisible=principal.HasClaim("permission","finance.read")});
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
          LEFT JOIN monthly_charges mc ON mc.enrollment_id=ce.id AND mc.billing_month=@month AND mc.is_trashed=FALSE
          LEFT JOIN LATERAL(SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE monthly_charge_id=mc.id AND is_trashed=FALSE) p ON TRUE
          WHERE ce.is_trashed=FALSE AND s.is_trashed=FALSE AND c.is_trashed=FALSE AND (ce.status='active' OR mc.id IS NOT NULL) AND ce.starts_on<=(@month+INTERVAL '1 month - 1 day')::date AND (ce.ends_on IS NULL OR ce.ends_on>=@month) AND (c.starts_on<=(@month+INTERVAL '1 month - 1 day')::date OR mc.id IS NOT NULL)
          ORDER BY c.name,s.full_name;
          """);cmd.Parameters.AddWithValue("month",month);await using var reader=await cmd.ExecuteReaderAsync(ct);
        while(await reader.ReadAsync(ct))rows.Add(new CollectionRow(reader.GetGuid(0),reader.IsDBNull(1)?null:reader.GetGuid(1),reader.GetGuid(2),reader.GetString(3),reader.GetString(4),reader.GetGuid(5),reader.GetString(6),reader.GetString(7),reader.GetDecimal(8),reader.GetDecimal(9),reader.GetDecimal(10),reader.IsDBNull(11)?null:reader.GetString(11),reader.GetString(12),month,reader.GetFieldValue<DateOnly>(13),reader.IsDBNull(14)?null:reader.GetFieldValue<DateOnly>(14),reader.GetFieldValue<DateOnly>(15)));
        return rows.ToArray();
    }

    private static StudentResponse ReadStudent(NpgsqlDataReader r,bool financeVisible)=>new(r.GetGuid(0),r.GetString(1),r.GetString(2),r.IsDBNull(3)?null:r.GetInt32(3),r.IsDBNull(4)?null:r.GetString(4),r.IsDBNull(5)?null:r.GetString(5),r.IsDBNull(6)?null:r.GetString(6),r.GetFieldValue<DateOnly>(7),r.GetString(8),r.IsDBNull(9)?null:r.GetString(9),r.GetFieldValue<DateTimeOffset>(10),r.GetFieldValue<DateTimeOffset>(11),r.GetString(12),financeVisible?r.GetDecimal(13):null,financeVisible?r.GetDecimal(14):null,financeVisible?r.GetString(15):null);
    private static TeacherResponse ReadTeacher(NpgsqlDataReader r,bool financeVisible)=>new(r.GetGuid(0),r.GetString(1),r.GetString(2),r.IsDBNull(3)?null:r.GetString(3),financeVisible?r.GetDecimal(4):null,r.GetString(5),r.IsDBNull(6)?null:r.GetString(6),r.GetFieldValue<DateTimeOffset>(7),r.GetFieldValue<DateTimeOffset>(8),r.GetString(9),r.GetInt64(10));
    private static CircleResponse ReadCircle(NpgsqlDataReader r,bool financeVisible)=>new(r.GetGuid(0),r.GetString(1),r.GetString(2),r.IsDBNull(3)?null:r.GetGuid(3),r.GetString(4),financeVisible?r.GetDecimal(5):null,r.IsDBNull(6)?null:r.GetString(6),r.GetBoolean(7),r.GetFieldValue<DateTimeOffset>(8),r.GetFieldValue<DateTimeOffset>(9),r.GetInt64(10),r.GetFieldValue<DateOnly>(11));

    private static Dictionary<string,string[]>? ValidateStudent(StudentWriteRequest r)
    {
        var e=new Dictionary<string,string[]>();if(string.IsNullOrWhiteSpace(r.FullName)||r.FullName.Trim().Length>180)e["fullName"]=["اسم الطالب مطلوب وبحد أقصى 180 حرفًا."];
        if(r.StudentCode?.Trim().Length>40)e["studentCode"]=["كود الطالب يجب ألا يتجاوز 40 حرفًا."];
        if(r.AgeYears is <0 or >120)e["ageYears"]=["العمر يجب أن يكون بين صفر و120 سنة."];
        if(r.Phone?.Trim().Length>40||r.GuardianPhone?.Trim().Length>40)e["phone"]=["رقم الهاتف يجب ألا يتجاوز 40 حرفًا."];
        if(r.GuardianName?.Trim().Length>180)e["guardianName"]=["اسم ولي الأمر طويل جدًا."];
        if(r.Notes?.Length>10000)e["notes"]=["الملاحظات طويلة جدًا."];
        string[] statuses=["active","paused","withdrawn","archived"];if(!statuses.Contains(r.Status,StringComparer.Ordinal))e["status"]=["اختر حالة صحيحة للطالب."];
        if(r.JoinedOn==default)e["joinedOn"]=["تاريخ الالتحاق غير صحيح."];
        return e.Count==0?null:e;
    }
    private static Dictionary<string,string[]>? ValidateTeacher(TeacherWriteRequest r)
    {
        var e=new Dictionary<string,string[]>();if(string.IsNullOrWhiteSpace(r.FullName)||r.FullName.Trim().Length>180)e["fullName"]=["اسم المعلمة مطلوب وبحد أقصى 180 حرفًا."];
        if(r.TeacherCode?.Trim().Length>40)e["teacherCode"]=["كود المعلمة طويل جدًا."];
        if(r.HourlyRate is < 0)e["hourlyRate"]=["أجر الساعة لا يمكن أن يكون سالبًا."];
        if(r.Phone?.Trim().Length>40)e["phone"]=["رقم الهاتف طويل جدًا."];
        if(!new[]{"active","inactive","archived"}.Contains(r.Status,StringComparer.Ordinal))e["status"]=["حالة المعلمة غير صحيحة."];
        return e.Count==0?null:e;
    }
    private static Dictionary<string,string[]>? ValidateCircle(CircleWriteRequest r)
    {
        var e=new Dictionary<string,string[]>();if(string.IsNullOrWhiteSpace(r.Name)||r.Name.Trim().Length>160)e["name"]=["اسم الحلقة مطلوب وبحد أقصى 160 حرفًا."];
        if(r.CircleCode?.Trim().Length>40)e["circleCode"]=["كود الحلقة طويل جدًا."];
        if(r.MonthlyFee is < 0)e["monthlyFee"]=["الرسوم لا يمكن أن تكون سالبة."];
        if(r.ScheduleText?.Length>300)e["scheduleText"]=["وصف المواعيد يجب ألا يتجاوز 300 حرف."];
        if(r.StartsOn==default)e["startsOn"]=["حدد تاريخ بدء الحلقة الفعلي."];
        return e.Count==0?null:e;
    }

    private static void AddStudentParams(NpgsqlCommand cmd,StudentWriteRequest r,string code)
    {
        cmd.Parameters.AddWithValue("code",code);cmd.Parameters.AddWithValue("name",r.FullName.Trim());cmd.Parameters.AddWithValue("age",r.AgeYears is null?(object)DBNull.Value:r.AgeYears.Value);
        AddNullable(cmd,"phone",r.Phone);AddNullable(cmd,"guardian",r.GuardianName);AddNullable(cmd,"guardianPhone",r.GuardianPhone);
        cmd.Parameters.AddWithValue("joined",r.JoinedOn);cmd.Parameters.AddWithValue("status",r.Status);AddNullable(cmd,"notes",r.Notes);
    }
    private static void AddNullable(NpgsqlCommand cmd,string name,string? value)=>cmd.Parameters.AddWithValue(name,string.IsNullOrWhiteSpace(value)?DBNull.Value:value.Trim());
    private static void AddNullableGuid(NpgsqlCommand cmd, string name, Guid? value)
    {
        // Keep nullable UUID parameters typed even when Value is DBNull. Parameters used
        // only inside jsonb_build_object have no target-column type for PostgreSQL to infer.
        var parameter = cmd.Parameters.Add(name, NpgsqlDbType.Uuid);
        parameter.Value = value.HasValue ? (object)value.Value : DBNull.Value;
    }
    private static string NewCode(string prefix)=>$"{prefix}-{DateTime.UtcNow:yyyyMMddHHmmssfff}-{Random.Shared.Next(10,99)}";
    private static bool CanReadFinance(ClaimsPrincipal principal) => principal.HasClaim("permission", "finance.read");
    private static bool CanEditFinancialValues(ClaimsPrincipal principal) => CanReadFinance(principal) && principal.HasClaim("permission", "finance.edit");
    private static Guid ActorId(ClaimsPrincipal user)=>Guid.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier),out var id)?id:Guid.Empty;

    private static async Task EnsureEnrollmentStatusBaselineAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Guid enrollmentId, DateOnly startsOn, string currentStatus, Guid actorId, CancellationToken ct)
    {
        await using var exists = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM audit_log WHERE entity_type='enrollment' AND entity_id=@id AND action_code IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end'));", conn, tx);
        exists.Parameters.AddWithValue("id", enrollmentId);
        if ((bool)(await exists.ExecuteScalarAsync(ct) ?? false)) return;

        // Legacy paused rows have no trustworthy historical pause date. Preserve their old effective history
        // as active from enrollment start, and establish the first provable paused point as today.
        await InsertEnrollmentStatusEventAsync(conn, tx, enrollmentId, "enrollment.status.baseline", "active", startsOn, "حالة أساس تاريخية؛ لا يتوفر تاريخ موثوق للإيقاف القديم.", actorId, ct);
        if (currentStatus == "paused")
            await InsertEnrollmentStatusEventAsync(conn, tx, enrollmentId, "enrollment.pause", "paused", DateOnly.FromDateTime(DateTime.Today), "تثبيت حالة الإيقاف القديمة من تاريخ تفعيل سجل الحالات.", actorId, ct);
    }

    private static async Task InsertEnrollmentStatusEventAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Guid enrollmentId, string actionCode, string status, DateOnly effectiveOn, string? reason, Guid actorId, CancellationToken ct)
    {
        await using var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,@action,'enrollment',@id,jsonb_build_object('status',@status,'effectiveOn',@effectiveOn,'reason',@reason));", conn, tx);
        audit.Parameters.AddWithValue("actor", actorId);
        audit.Parameters.AddWithValue("action", actionCode);
        audit.Parameters.AddWithValue("id", enrollmentId);
        audit.Parameters.AddWithValue("status", status);
        audit.Parameters.AddWithValue("effectiveOn", effectiveOn);
        audit.Parameters.AddWithValue("reason", (object?)reason?.Trim() ?? DBNull.Value);
        await audit.ExecuteNonQueryAsync(ct);
    }

    private static async Task<DateOnly?> GetLatestEnrollmentStatusDateAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Guid enrollmentId, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("SELECT NULLIF(details->>'effectiveOn','')::date FROM audit_log WHERE entity_type='enrollment' AND entity_id=@id AND action_code IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end') ORDER BY NULLIF(details->>'effectiveOn','')::date DESC,occurred_at DESC,id DESC LIMIT 1;", conn, tx);
        cmd.Parameters.AddWithValue("id", enrollmentId);
        var value = await cmd.ExecuteScalarAsync(ct);
        return value is DateOnly date ? date : null;
    }

    private static bool TryMonth(string? input,out DateOnly month)
    {
        month=default;if(string.IsNullOrWhiteSpace(input)||!DateOnly.TryParseExact(input+"-01","yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.None,out var parsed))return false;
        month=parsed;return true;
    }
}

public sealed record StudentWriteRequest(string? StudentCode,string FullName,int? AgeYears,string? Phone,string? GuardianName,string? GuardianPhone,DateOnly JoinedOn,string Status,string? Notes);
public sealed record StudentStatusRequest(string Status, DateOnly? EffectiveOn = null);
public sealed record StudentResponse(Guid Id,string StudentCode,string FullName,int? AgeYears,string? Phone,string? GuardianName,string? GuardianPhone,DateOnly JoinedOn,string Status,string? Notes,DateTimeOffset CreatedAt,DateTimeOffset UpdatedAt,string CircleNames,decimal? CurrentMonthDue,decimal? CurrentMonthPaid,string? CurrentMonthPaymentStatus);
public sealed record StudentNoteRequest(string NoteText);
public sealed record StudentNoteResponse(Guid Id,string NoteText,DateTimeOffset CreatedAt,string CreatedBy);
public sealed record TeacherWriteRequest(string? TeacherCode,string FullName,string? Phone,decimal? HourlyRate,string Status,string? Notes);
public sealed record TeacherResponse(Guid Id,string TeacherCode,string FullName,string? Phone,decimal? HourlyRate,string Status,string? Notes,DateTimeOffset CreatedAt,DateTimeOffset UpdatedAt,string CircleNames,long CircleCount);
public sealed record CircleWriteRequest(string? CircleCode,string Name,Guid? TeacherId,decimal? MonthlyFee,string? ScheduleText,bool IsActive,DateOnly StartsOn);
public sealed record CircleResponse(Guid Id,string CircleCode,string Name,Guid? TeacherId,string TeacherName,decimal? MonthlyFee,string? ScheduleText,bool IsActive,DateTimeOffset CreatedAt,DateTimeOffset UpdatedAt,long ActiveStudentCount,DateOnly StartsOn);
public sealed record EnrollmentWriteRequest(Guid StudentId,Guid CircleId,DateOnly StartsOn,decimal? AgreedMonthlyFee,bool AllowClosedCircle = false);
public sealed record EnrollmentEndRequest(DateOnly? EndsOn);
public sealed record EnrollmentStatusChangeRequest(DateOnly? EffectiveOn, string? Reason);
public sealed record ScheduleSlotWriteRequest(Guid CircleId,int DayOfWeek,string StartsAt,int DurationMinutes);
public sealed record TeacherAttendanceMarkRequest(Guid ScheduleSlotId,DateOnly SessionDate,string Status,string? Note,Guid? TeacherId = null);
public sealed record TeacherAttendanceDurationRequest(int DurationMinutes);
public sealed record StudentAttendanceMarkRequest(Guid ScheduleSlotId,Guid EnrollmentId,DateOnly SessionDate,string Status,string? Note,bool AllowHistoricalEntry = false);
public sealed record AdvertisingExpenseWriteRequest(Guid CircleId,string? Platform,DateOnly StartDate,int DaysCount,decimal DailyCost,string? Note);
public sealed record OperatingExpenseWriteRequest(DateOnly ExpenseDate,string Category,string Description,decimal Amount,Guid? CircleId,string? Note);
public sealed record ChargeWriteRequest(Guid EnrollmentId,string BillingMonth,decimal AmountDue,string? Note);
public sealed record ChargeUpdateRequest(decimal AmountDue,string? Note);
public sealed record PaymentWriteRequest(Guid MonthlyChargeId,decimal Amount,DateTimeOffset? PaidAt,string? Method,string? Reference,string? Note);
public sealed record CollectionReportCreateRequest(string BillingMonth,string? Title);
public sealed record CollectionRow(Guid EnrollmentId,Guid? ChargeId,Guid StudentId,string StudentCode,string StudentName,Guid CircleId,string CircleName,string TeacherName,decimal AgreedMonthlyFee,decimal AmountDue,decimal PaidAmount,string? Note,string PaymentStatus,DateOnly BillingMonth,DateOnly EnrollmentStartsOn,DateOnly? EnrollmentEndsOn,DateOnly CircleStartsOn)
{
    public decimal Balance=>Math.Max(0,AmountDue-PaidAmount);
}
public sealed record PaymentHistory(Guid Id,decimal Amount,DateTimeOffset PaidAt,string? Method,string? Reference,string? Note,bool HasReceipt);
public sealed class ChargeHistoryBuilder(Guid id,DateOnly billingMonth,decimal amountDue,string? note,string circleName)
{
    public Guid Id {get;}=id; public DateOnly BillingMonth {get;}=billingMonth; public decimal AmountDue {get;}=amountDue; public string? Note {get;}=note; public string CircleName {get;}=circleName; public List<PaymentHistory> Payments {get;}=[];
    public object ToResponse()=>new{id=Id,billingMonth=BillingMonth,amountDue=AmountDue,paidAmount=Payments.Sum(p=>p.Amount),balance=Math.Max(0,AmountDue-Payments.Sum(p=>p.Amount)),note=Note,circleName=CircleName,payments=Payments};
}
