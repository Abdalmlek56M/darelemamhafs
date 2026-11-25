using System.Reflection;
using Npgsql;
using Dar.Common.Permissions;

namespace DarEltahfeez.Api.Scoping;

internal static class AuditTrashScopeResolver
{
    public static async Task<ScopeTarget?> ResolveAuditAsync(NpgsqlConnection connection, long id)
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

    public static async Task<ScopeTarget?> ResolveTrashAsync(NpgsqlConnection connection, Guid id)
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

    public static async Task<ScopeTarget> ResolveTrashBodyAsync(NpgsqlConnection connection, EndpointFilterInvocationContext context)
    {
        var body = context.Arguments.FirstOrDefault(arg => arg?.GetType().Name == "TrashCreateRequest");
        var type = body?.GetType().GetProperty("EntityType", BindingFlags.Public | BindingFlags.Instance)?.GetValue(body) as string;
        var entityId = body?.GetType().GetProperty("EntityId", BindingFlags.Public | BindingFlags.Instance)?.GetValue(body);
        return entityId is Guid guid ? await EntityTargetAsync(connection, type, guid) : ScopeTarget.UnlinkedTarget;
    }

    public static async Task<ScopeTarget> EntityTargetAsync(NpgsqlConnection connection, string? rawType, Guid id)
    {
        var type = (rawType ?? string.Empty).Replace('_', '-').ToLowerInvariant();
        var sql = type switch
        {
            "student" or "students" => "SELECT c.teacher_id,ce.circle_id FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id WHERE ce.student_id=@id AND ce.is_trashed=FALSE GROUP BY c.teacher_id,ce.circle_id HAVING COUNT(*)=(SELECT COUNT(*) FROM circle_enrollments x WHERE x.student_id=@id AND x.is_trashed=FALSE) LIMIT 1;",
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
            "circle" or "circles" => "SELECT teacher_id,id FROM circles WHERE id=@id;",
            "teacher" or "teachers" => "SELECT id,NULL::uuid FROM teachers WHERE id=@id;",
            _ => null
        };
        if (sql is null) return ScopeTarget.UnlinkedTarget;
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue("id", id);
        await using var reader = await command.ExecuteReaderAsync();
        return await reader.ReadAsync() ? new ScopeTarget(reader.IsDBNull(1) ? null : reader.GetGuid(1), reader.IsDBNull(0) ? null : reader.GetGuid(0)) : ScopeTarget.UnlinkedTarget;
    }
}
