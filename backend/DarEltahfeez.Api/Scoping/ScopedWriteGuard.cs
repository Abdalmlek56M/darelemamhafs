using System.Security.Claims;
using Npgsql;
using Dar.Common.Permissions;

namespace DarEltahfeez.Api.Scoping;

internal static class ScopedWriteGuard
{
    public static async Task<IResult?> RequireEntityAsync(NpgsqlDataSource db, ClaimsPrincipal principal, string entityType, Guid id, CancellationToken ct)
    {
        await using var connection = await db.OpenConnectionAsync(ct);
        var scope = await ScopeLoader.LoadAsync(connection, principal, ct);
        if (scope.All) return null;
        var target = await AuditTrashScopeResolver.EntityTargetAsync(connection, entityType, id);
        return ScopedEntityRules.Allows(scope, target) ? null : ScopeArgument.Denied();
    }
}
