namespace Dar.Common.Permissions;

/// <summary>A resolved ownership target. Unlinked targets fail closed for scoped users.</summary>
public readonly record struct ScopeTarget(Guid? CircleId, Guid? TeacherId, bool Unlinked = false)
{
    public static ScopeTarget UnlinkedTarget => new(null, null, true);
}

public static class ScopedEntityRules
{
    /// <summary>
    /// Unscoped users and users.manage are always allowed. A scoped user is allowed only
    /// when the target is linked to an allowed circle/teacher; unlinked targets fail closed.
    /// </summary>
    public static bool Allows(AccessScope scope, ScopeTarget target)
    {
        if (scope.All) return true;
        if (target.Unlinked || (target.CircleId is null && target.TeacherId is null)) return false;
        return scope.AllowsTarget(target.CircleId, target.TeacherId);
    }
}
