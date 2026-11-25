using Npgsql;
using Dar.Common.Permissions;

namespace DarEltahfeez.Api.Scoping;

internal static class AcademicScopeResolver
{
    public static async Task<ScopeTarget> ResolveCircleWriteAsync(NpgsqlConnection connection, EndpointFilterInvocationContext context, bool withSchedule)
    {
        var typeName = withSchedule ? "CircleWithScheduleRequest" : "CircleWriteRequest";
        var teacherId = ScopeArgument.GuidProperty(context, typeName, "TeacherId");
        return teacherId is { } id ? await AuditTrashScopeResolver.EntityTargetAsync(connection, "teacher", id) : ScopeTarget.UnlinkedTarget;
    }

    public static async Task<ScopeTarget> ResolveEnrollmentWriteAsync(NpgsqlConnection connection, EndpointFilterInvocationContext context, string typeName)
    {
        var circleId = ScopeArgument.GuidProperty(context, typeName, "CircleId");
        return circleId is { } id ? await AuditTrashScopeResolver.EntityTargetAsync(connection, "circle", id) : ScopeTarget.UnlinkedTarget;
    }
}
