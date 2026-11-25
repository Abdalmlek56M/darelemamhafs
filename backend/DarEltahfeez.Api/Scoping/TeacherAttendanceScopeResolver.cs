using Npgsql;
using Dar.Common.Permissions;

namespace DarEltahfeez.Api.Scoping;

internal static class TeacherAttendanceScopeResolver
{
    public static async Task<ScopeTarget?> ResolveAttendanceAsync(NpgsqlConnection connection, Guid id)
    {
        await using var command = new NpgsqlCommand("SELECT teacher_id,circle_id FROM teacher_attendance WHERE id=@id;", connection);
        command.Parameters.AddWithValue("id", id);
        await using var reader = await command.ExecuteReaderAsync();
        return await reader.ReadAsync() ? new ScopeTarget(reader.GetGuid(1), reader.GetGuid(0)) : null;
    }

    public static async Task<ScopeTarget?> ResolveMarkAsync(NpgsqlConnection connection, TeacherAttendanceMarkRequest? request)
    {
        if (request is null) return ScopeTarget.UnlinkedTarget;
        await using var command = new NpgsqlCommand("SELECT ss.circle_id,c.teacher_id FROM circle_schedule_slots ss JOIN circles c ON c.id=ss.circle_id WHERE ss.id=@slot;", connection);
        command.Parameters.AddWithValue("slot", request.ScheduleSlotId);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;
        return new ScopeTarget(reader.GetGuid(0), request.TeacherId ?? (reader.IsDBNull(1) ? null : reader.GetGuid(1)));
    }
}
