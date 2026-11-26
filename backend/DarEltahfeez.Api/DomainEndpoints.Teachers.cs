using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private static void MapTeachers(WebApplication app)
    {
        var route = app.MapGroup("/api/teachers");
        route.MapGet("", (ClaimsPrincipal principal, string? search, string? status, int? page, int? pageSize, HttpContext http, NpgsqlDataSource db, CancellationToken ct) => LoadLegacyTeachersAsync(principal, search, status, page, pageSize, http, db, ct)).RequireAuthorization("teachers.read");

        route.MapGet("/{id:guid}/history", (Guid id, int? page, int? pageSize, HttpContext http, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) => TeacherHistory(db, id, page, pageSize, http, principal, ct))
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
        }).RequireAuthorization("teachers.edit").AddEndpointFilter<ScopedAccessEndpointFilter>();

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
        }).RequireAuthorization("teachers.create").AddEndpointFilter<ScopedAccessEndpointFilter>();

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
        }).RequireAuthorization("teachers.edit").AddEndpointFilter<ScopedAccessEndpointFilter>();

    }
}