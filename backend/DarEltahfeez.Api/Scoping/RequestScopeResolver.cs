using Npgsql;
using Dar.Common.Permissions;

namespace DarEltahfeez.Api.Scoping;

internal static class RequestScopeResolver
{
    public static async Task<ScopeTarget?> ResolveAsync(NpgsqlConnection connection, Guid id)
    {
        await using var command = new NpgsqlCommand("SELECT teacher_id,circle_id FROM attendance_requests WHERE id=@id;", connection);
        command.Parameters.AddWithValue("id", id);
        await using var reader = await command.ExecuteReaderAsync();
        return await reader.ReadAsync() ? new ScopeTarget(reader.GetGuid(1), reader.GetGuid(0)) : null;
    }
}
