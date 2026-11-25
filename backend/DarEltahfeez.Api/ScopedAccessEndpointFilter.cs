using System.Reflection;
using Npgsql;
using Dar.Common.Permissions;

namespace DarEltahfeez.Api;

/// <summary>
/// Applies the shared scope rules to legacy endpoints. Unscoped users and users.manage
/// keep their current access; a scoped user is denied for linked targets outside scope
/// and for unlinked targets that cannot be resolved (fail closed).
/// </summary>
public sealed class ScopedAccessEndpointFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (http.User.Identity?.IsAuthenticated != true) return await next(context);
        var dataSource = http.RequestServices.GetRequiredService<NpgsqlDataSource>();
        await using var connection = await dataSource.OpenConnectionAsync(http.RequestAborted);
        var scope = await ScopeLoader.LoadAsync(connection, http.User, http.RequestAborted);
        if (scope.All) return await next(context);

        var target = await ResolveTargetAsync(connection, context);
        if (target is null) return await next(context); // let the handler return its normal 404
        if (ScopedEntityRules.Allows(scope, target.Value)) return await next(context);
        return Results.Json(new { message = "هذا السجل خارج نطاقك." }, statusCode: StatusCodes.Status403Forbidden);
    }

    private static async Task<ScopeTarget?> ResolveTargetAsync(NpgsqlConnection connection, EndpointFilterInvocationContext context)
    {
        var http = context.HttpContext;
        var path = http.Request.Path.Value?.ToLowerInvariant() ?? string.Empty;
        var id = RouteGuid(http, "id");
        if (path.Contains("/api/admin/requests/") && id is not null)
            return await RequestTargetAsync(connection, id.Value);
        if (path.StartsWith("/api/teacher-attendance/") && http.Request.Method == "PUT" && id is not null)
            return await AttendanceTargetAsync(connection, id.Value);
        if (path.Contains("/api/admin/audit-log/") && path.EndsWith("/restore-before")
            && long.TryParse(http.Request.RouteValues["id"]?.ToString(), out var auditId))
            return await AuditTargetAsync(connection, auditId);
        if (path.StartsWith("/api/admin/trash/") && id is not null)
            return await TrashTargetAsync(connection, id.Value);
        if (path == "/api/admin/trash" && http.Request.Method == "POST")
        {
            var body = context.Arguments.FirstOrDefault(arg => arg?.GetType().Name == "TrashCreateRequest");
            var type = body?.GetType().GetProperty("EntityType", BindingFlags.Public | BindingFlags.Instance)?.GetValue(body) as string;
            var entityId = body?.GetType().GetProperty("EntityId", BindingFlags.Public | BindingFlags.Instance)?.GetValue(body);
            return entityId is Guid guid ? await EntityTargetAsync(connection, type, guid) : ScopeTarget.UnlinkedTarget;
        }
        if (path == "/api/teacher-attendance" && http.Request.Method == "POST")
            return await TeacherMarkTargetAsync(connection, context.Arguments.FirstOrDefault(arg => arg is TeacherAttendanceMarkRequest) as TeacherAttendanceMarkRequest);
        if (path == "/api/student-attendance" && http.Request.Method == "POST")
            return await StudentMarkTargetAsync(connection, context.Arguments.FirstOrDefault(arg => arg is StudentAttendanceMarkRequest) as StudentAttendanceMarkRequest);
        return null;
    }

    private static Guid? RouteGuid(HttpContext http, string key) => Guid.TryParse(http.Request.RouteValues[key]?.ToString(), out var id) ? id : null;

    private static async Task<ScopeTarget?> RequestTargetAsync(NpgsqlConnection connection, Guid id)
    {
        await using var command = new NpgsqlCommand("SELECT teacher_id,circle_id FROM attendance_requests WHERE id=@id;", connection);
        command.Parameters.AddWithValue("id", id);
        await using var reader = await command.ExecuteReaderAsync();
        return await reader.ReadAsync() ? new ScopeTarget(reader.GetGuid(1), reader.GetGuid(0)) : null;
    }

    private static async Task<ScopeTarget?> AttendanceTargetAsync(NpgsqlConnection connection, Guid id)
    {
        await using var command = new NpgsqlCommand("SELECT teacher_id,circle_id FROM teacher_attendance WHERE id=@id;", connection);
        command.Parameters.AddWithValue("id", id);
        await using var reader = await command.ExecuteReaderAsync();
        return await reader.ReadAsync() ? new ScopeTarget(reader.GetGuid(1), reader.GetGuid(0)) : null;
    }

    private static async Task<ScopeTarget?> TeacherMarkTargetAsync(NpgsqlConnection connection, TeacherAttendanceMarkRequest? request)
    {
        if (request is null) return ScopeTarget.UnlinkedTarget;
        await using var command = new NpgsqlCommand("SELECT ss.circle_id,c.teacher_id FROM circle_schedule_slots ss JOIN circles c ON c.id=ss.circle_id WHERE ss.id=@slot;", connection);
        command.Parameters.AddWithValue("slot", request.ScheduleSlotId);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;
        return new ScopeTarget(reader.GetGuid(0), request.TeacherId ?? (reader.IsDBNull(1) ? null : reader.GetGuid(1)));
    }

    private static async Task<ScopeTarget?> StudentMarkTargetAsync(NpgsqlConnection connection, StudentAttendanceMarkRequest? request)
    {
        if (request is null) return ScopeTarget.UnlinkedTarget;
        await using var command = new NpgsqlCommand("SELECT ce.circle_id,c.teacher_id FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id WHERE ce.id=@id;", connection);
        command.Parameters.AddWithValue("id", request.EnrollmentId);
        await using var reader = await command.ExecuteReaderAsync();
        return await reader.ReadAsync() ? new ScopeTarget(reader.GetGuid(0), reader.IsDBNull(1) ? null : reader.GetGuid(1)) : null;
    }

    private static async Task<ScopeTarget?> AuditTargetAsync(NpgsqlConnection connection, long id)
    {
        string? type = null; Guid? entityId = null;
        await using (var command = new NpgsqlCommand("SELECT entity_type,entity_id FROM audit_log WHERE id=@id;", connection))
        {
            command.Parameters.AddWithValue("id", id);
            await using var reader = await command.ExecuteReaderAsync();
            if (await reader.ReadAsync()) { type = reader.GetString(0); entityId = reader.IsDBNull(1) ? null : reader.GetGuid(1); }
        }
        return entityId is { } value ? await EntityTargetAsync(connection, type, value) : ScopeTarget.UnlinkedTarget;
    }

    private static async Task<ScopeTarget?> TrashTargetAsync(NpgsqlConnection connection, Guid id)
    {
        string? type = null; Guid? entityId = null;
        await using (var command = new NpgsqlCommand("SELECT entity_type,entity_id FROM trash_items WHERE id=@id;", connection))
        {
            command.Parameters.AddWithValue("id", id);
            await using var reader = await command.ExecuteReaderAsync();
            if (await reader.ReadAsync()) { type = reader.GetString(0); entityId = reader.GetGuid(1); }
        }
        return entityId is { } value ? await EntityTargetAsync(connection, type, value) : null;
    }

    private static async Task<ScopeTarget> EntityTargetAsync(NpgsqlConnection connection, string? rawType, Guid id)
    {
        var type = (rawType ?? string.Empty).Replace('_', '-').ToLowerInvariant();
        var sql = type switch
        {
            "teacher-attendance" => "SELECT teacher_id,circle_id FROM teacher_attendance WHERE id=@id;",
            "student-attendance" => "SELECT c.teacher_id,ce.circle_id FROM student_attendance sa JOIN circle_enrollments ce ON ce.id=sa.enrollment_id JOIN circles c ON c.id=ce.circle_id WHERE sa.id=@id;",
            "payment" or "payments" => "SELECT c.teacher_id,ce.circle_id FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN circles c ON c.id=ce.circle_id WHERE p.id=@id;",
            "monthly-charge" or "charges" => "SELECT c.teacher_id,ce.circle_id FROM monthly_charges mc JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN circles c ON c.id=ce.circle_id WHERE mc.id=@id;",
            "enrollment" or "circle-enrollment" => "SELECT c.teacher_id,ce.circle_id FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id WHERE ce.id=@id;",
            "schedule-slot" => "SELECT c.teacher_id,ss.circle_id FROM circle_schedule_slots ss JOIN circles c ON c.id=ss.circle_id WHERE ss.id=@id;",
            "teacher-session" => "SELECT teacher_id,circle_id FROM teacher_sessions WHERE id=@id;",
            "teacher-note" => "SELECT teacher_id,NULL::uuid FROM teacher_notes WHERE id=@id;",
            "advertising-expense" => "SELECT c.teacher_id,c.id FROM advertising_expenses a JOIN circles c ON c.id=a.circle_id WHERE a.id=@id;",
            "operating-expense" => "SELECT c.teacher_id,c.id FROM operating_expenses e JOIN circles c ON c.id=e.circle_id WHERE e.id=@id;",
            "circle" => "SELECT teacher_id,id FROM circles WHERE id=@id;",
            "teacher" => "SELECT id,NULL::uuid FROM teachers WHERE id=@id;",
            _ => null
        };
        if (sql is null) return ScopeTarget.UnlinkedTarget;
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue("id", id);
        await using var reader = await command.ExecuteReaderAsync();
        return await reader.ReadAsync() ? new ScopeTarget(reader.IsDBNull(1) ? null : reader.GetGuid(1), reader.IsDBNull(0) ? null : reader.GetGuid(0)) : ScopeTarget.UnlinkedTarget;
    }
}
