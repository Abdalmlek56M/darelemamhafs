using System.Security.Claims;
using Npgsql;

namespace Dar.Common.Permissions;

/// <summary>Resolved access scope for a user. No scope rows means All, matching existing behavior.</summary>
public sealed record AccessScope(bool All, Guid[] CircleIds, Guid[] TeacherIds)
{
    public static readonly AccessScope AllScope = new(true, [], []);

    public bool AllowsCircle(Guid id) => All || CircleIds.Contains(id);
    public bool AllowsTeacher(Guid id) => All || TeacherIds.Contains(id);

    public bool AllowsTarget(Guid? circleId, Guid? teacherId)
    {
        if (All) return true;
        if (circleId is null && teacherId is null) return false;
        if (circleId is { } cid && !AllowsCircle(cid)) return false;
        if (teacherId is { } tid && !AllowsTeacher(tid)) return false;
        return true;
    }
}
