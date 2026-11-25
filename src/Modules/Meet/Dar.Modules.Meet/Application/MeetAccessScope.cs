using System.Security.Claims;
using Dar.Common.Permissions;
using Npgsql;

namespace Dar.Modules.Meet.Application;

/// <summary>Thin adapter over the shared AccessScope rules for meeting data.</summary>
public sealed record MeetAccessScope(AccessScope Inner)
{
    public static readonly MeetAccessScope AllScope = new(AccessScope.AllScope);

    public bool All => Inner.All;
    public Guid[] CircleIds => Inner.CircleIds;
    public bool AllowsCircle(Guid? circleId) => Inner.All || (circleId is { } id && Inner.AllowsCircle(id));

    public static async Task<MeetAccessScope> LoadAsync(NpgsqlDataSource dataSource, ClaimsPrincipal principal, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        return new(await ScopeLoader.LoadAsync(connection, principal, ct));
    }
}
