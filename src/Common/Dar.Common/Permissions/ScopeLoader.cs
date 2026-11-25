using System.Security.Claims;
using System.Security.Claims;
using Npgsql;

namespace Dar.Common.Permissions;

/// <summary>Loads app_user_scopes and expands teacher scopes to their circles.</summary>
public static class ScopeLoader
{
    public static async Task<AccessScope> LoadAsync(NpgsqlConnection connection, ClaimsPrincipal principal, CancellationToken ct)
    {
        if (principal.HasClaim("permission", "users.manage")) return AccessScope.AllScope;
        var userIdValue = principal.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? principal.FindFirst("sub")?.Value;
        if (!Guid.TryParse(userIdValue, out var userId) || userId == Guid.Empty)
            return new AccessScope(false, [], []);

        var directCircles = new List<Guid>();
        var directTeachers = new List<Guid>();
        await using (var scopes = new NpgsqlCommand("SELECT scope_type, scope_id FROM app_user_scopes WHERE user_id = @user;", connection))
        {
            scopes.Parameters.AddWithValue("user", userId);
            await using var reader = await scopes.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                if (reader.GetString(0) == "circle") directCircles.Add(reader.GetGuid(1));
                else directTeachers.Add(reader.GetGuid(1));
            }
        }

        if (directCircles.Count == 0 && directTeachers.Count == 0) return AccessScope.AllScope;
        var circles = new HashSet<Guid>(directCircles);
        var teachers = new HashSet<Guid>(directTeachers);
        if (teachers.Count > 0)
        {
            await using var expand = new NpgsqlCommand("SELECT id FROM circles WHERE is_trashed = FALSE AND teacher_id = ANY(@teachers);", connection);
            expand.Parameters.AddWithValue("teachers", teachers.ToArray());
            await using var reader = await expand.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) circles.Add(reader.GetGuid(0));
        }
        if (circles.Count > 0)
        {
            await using var expand = new NpgsqlCommand("SELECT DISTINCT teacher_id FROM circles WHERE is_trashed = FALSE AND teacher_id IS NOT NULL AND id = ANY(@circles);", connection);
            expand.Parameters.AddWithValue("circles", circles.ToArray());
            await using var reader = await expand.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) teachers.Add(reader.GetGuid(0));
        }
        return new AccessScope(false, circles.ToArray(), teachers.ToArray());
    }
}
