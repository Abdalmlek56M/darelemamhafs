using Npgsql;
using Dar.Common.Permissions;

namespace DarEltahfeez.Api.Scoping;

internal static class StudentAttendanceScopeResolver
{
    public static async Task<ScopeTarget?> ResolveAsync(NpgsqlConnection connection, StudentAttendanceMarkRequest? request)
    {
        if (request is null) return ScopeTarget.UnlinkedTarget;
        await using var command = new NpgsqlCommand("SELECT ce.circle_id,c.teacher_id FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id WHERE ce.id=@id;", connection);
        command.Parameters.AddWithValue("id", request.EnrollmentId);
        await using var reader = await command.ExecuteReaderAsync();
        return await reader.ReadAsync() ? new ScopeTarget(reader.GetGuid(0), reader.IsDBNull(1) ? null : reader.GetGuid(1)) : null;
    }
}
