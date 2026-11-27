using System.Security.Claims;
using Npgsql;

namespace Dar.Common.Permissions;

/// <summary>Loads app_user_scopes and expands teacher scopes to their circles.</summary>
public static class ScopeLoader
{
    // Tier 2.7: the old loader ran up to three sequential commands on the request connection
    // (read scopes, expand teachers -> circles, expand circles -> teachers). This single
    // command computes exactly the same sets (two UNIONs instead of HashSet insertion, so the
    // order of the returned ids may differ but every membership check is unchanged).
    /// <summary>
    /// Reads the user's scope rows and both expansion directions in one round trip.
    /// Returns the fail-open AllScope when the account has no scope rows (existing behavior).
    /// </summary>
    private const string LoadScopeSql = """
        WITH raw_scopes AS (
            SELECT scope_type, scope_id FROM app_user_scopes WHERE user_id = @user
        ),
        direct_circles AS (
            SELECT scope_id FROM raw_scopes WHERE scope_type = 'circle'
        ),
        direct_teachers AS (
            SELECT scope_id FROM raw_scopes WHERE scope_type <> 'circle'
        ),
        expanded_circles AS (
            SELECT c.id
            FROM circles c
            WHERE c.is_trashed = FALSE
              AND c.teacher_id IN (SELECT scope_id FROM direct_teachers)
        ),
        all_circles AS (
            SELECT scope_id FROM direct_circles
            UNION
            SELECT id FROM expanded_circles
        ),
        all_teachers AS (
            SELECT scope_id FROM direct_teachers
            UNION
            SELECT c.teacher_id
            FROM circles c
            WHERE c.is_trashed = FALSE AND c.teacher_id IS NOT NULL
              AND c.id IN (SELECT scope_id FROM all_circles)
        )
        SELECT (SELECT COUNT(*) FROM raw_scopes),
               ARRAY(SELECT scope_id FROM all_circles),
               ARRAY(SELECT scope_id FROM all_teachers);
        """;

    /// <summary>users.manage holders bypass scope filtering (unchanged rule).</summary>
    public static bool IsAllScope(ClaimsPrincipal principal) =>
        principal.HasClaim("permission", "users.manage");

    /// <summary>The principal's app_users id, or null when the claim is missing/invalid.</summary>
    public static Guid? UserId(ClaimsPrincipal principal)
    {
        var value = principal.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? principal.FindFirst("sub")?.Value;
        return Guid.TryParse(value, out var id) && id != Guid.Empty ? id : null;
    }

    public static async Task<AccessScope> LoadAsync(NpgsqlConnection connection, ClaimsPrincipal principal, CancellationToken ct)
    {
        if (IsAllScope(principal)) return AccessScope.AllScope;
        var userId = UserId(principal);
        if (userId is null) return new AccessScope(false, [], []);

        await using var command = new NpgsqlCommand(LoadScopeSql, connection);
        command.Parameters.AddWithValue("user", userId.Value);
        await using var reader = await command.ExecuteReaderAsync(ct);
        await reader.ReadAsync(ct);
        if (reader.GetInt64(0) == 0) return AccessScope.AllScope;
        return new AccessScope(false, reader.GetFieldValue<Guid[]>(1), reader.GetFieldValue<Guid[]>(2));
    }
}
