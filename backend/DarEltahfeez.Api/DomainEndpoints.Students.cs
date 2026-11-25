using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
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
        }).RequireAuthorization("students.create").AddEndpointFilter<ScopedAccessEndpointFilter>();

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
        }).RequireAuthorization("students.edit").AddEndpointFilter<ScopedAccessEndpointFilter>();

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
        }).RequireAuthorization("students.edit").AddEndpointFilter<ScopedAccessEndpointFilter>();


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
        }).RequireAuthorization("students.edit").AddEndpointFilter<ScopedAccessEndpointFilter>();

    }
}