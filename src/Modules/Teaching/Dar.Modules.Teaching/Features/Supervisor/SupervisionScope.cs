using System.Security.Claims;
using Dar.Common.Permissions;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Supervisor;

/// <summary>Thin compatibility adapter over the shared AccessScope rules.</summary>
public sealed record SupervisionScope(AccessScope Inner)
{
    public static readonly SupervisionScope AllScope = new(AccessScope.AllScope);

    public bool All => Inner.All;
    public Guid[] CircleIds => Inner.CircleIds;
    public Guid[] TeacherIds => Inner.TeacherIds;
    public bool AllowsCircle(Guid id) => Inner.AllowsCircle(id);
    public bool AllowsTeacher(Guid id) => Inner.AllowsTeacher(id);

    public static async Task<SupervisionScope> LoadAsync(NpgsqlConnection connection, ClaimsPrincipal principal, CancellationToken ct) =>
        new(await ScopeLoader.LoadAsync(connection, principal, ct));
}
