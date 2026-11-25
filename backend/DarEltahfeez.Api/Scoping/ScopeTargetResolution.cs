using System.Reflection;
using Npgsql;
using Dar.Common.Permissions;

namespace DarEltahfeez.Api.Scoping;

internal static class ScopeTargetResolution
{
    public static async Task<ScopeTarget?> ResolveAsync(NpgsqlConnection connection, EndpointFilterInvocationContext context)
    {
        var http = context.HttpContext;
        var path = http.Request.Path.Value?.ToLowerInvariant() ?? string.Empty;
        var id = RouteGuid(http, "id");
        if (path.Contains("/api/admin/requests/") && id is not null)
            return await RequestScopeResolver.ResolveAsync(connection, id.Value);
        if (path.StartsWith("/api/teacher-attendance/") && http.Request.Method == "PUT" && id is not null)
            return await TeacherAttendanceScopeResolver.ResolveAttendanceAsync(connection, id.Value);
        if (path.Contains("/api/admin/audit-log/") && path.EndsWith("/restore-before")
            && long.TryParse(http.Request.RouteValues["id"]?.ToString(), out var auditId))
            return await AuditTrashScopeResolver.ResolveAuditAsync(connection, auditId);
        if (path.StartsWith("/api/admin/trash/") && id is not null)
            return await AuditTrashScopeResolver.ResolveTrashAsync(connection, id.Value);
        if (path == "/api/admin/trash" && http.Request.Method == "POST")
            return await AuditTrashScopeResolver.ResolveTrashBodyAsync(connection, context);
        if (path == "/api/teacher-attendance" && http.Request.Method == "POST")
            return await TeacherAttendanceScopeResolver.ResolveMarkAsync(connection, context.Arguments.FirstOrDefault(arg => arg is TeacherAttendanceMarkRequest) as TeacherAttendanceMarkRequest);
        if (path == "/api/student-attendance" && http.Request.Method == "POST")
            return await StudentAttendanceScopeResolver.ResolveAsync(connection, context.Arguments.FirstOrDefault(arg => arg is StudentAttendanceMarkRequest) as StudentAttendanceMarkRequest);
        return null;
    }

    private static Guid? RouteGuid(HttpContext http, string key) => Guid.TryParse(http.Request.RouteValues[key]?.ToString(), out var id) ? id : null;
}
