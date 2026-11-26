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
        if (path == "/api/charges" && http.Request.Method == "POST")
            return await FinanceScopeResolver.ResolveChargeWriteAsync(connection, context);
        if (path.Contains("/api/charges/") && id is not null && (http.Request.Method == "PUT" || path.EndsWith("/void")))
            return await AuditTrashScopeResolver.EntityTargetAsync(connection, "monthly-charge", id.Value);
        if (path == "/api/payments" && http.Request.Method == "POST")
            return await FinanceScopeResolver.ResolvePaymentWriteAsync(connection, context);
        if (path == "/api/payments/with-receipt" && http.Request.Method == "POST")
            return await ResolveReceiptPaymentAsync(connection, context, http.RequestAborted);
        if (path.StartsWith("/api/payments/") && path.EndsWith("/void") && id is not null)
            return await AuditTrashScopeResolver.EntityTargetAsync(connection, "payment", id.Value);
        if (path == "/api/advertising-expenses" && http.Request.Method == "POST")
            return await FinanceScopeResolver.ResolveAdvertisingWriteAsync(connection, context);
        if (path.StartsWith("/api/advertising-expenses/") && http.Request.Method == "PUT" && id is not null)
            return await AuditTrashScopeResolver.EntityTargetAsync(connection, "advertising-expense", id.Value);
        if (path == "/api/operating-expenses" && http.Request.Method == "POST")
            return await FinanceScopeResolver.ResolveOperatingWriteAsync(connection, context);
        if (path.StartsWith("/api/operating-expenses/") && http.Request.Method == "PUT" && id is not null)
            return await AuditTrashScopeResolver.EntityTargetAsync(connection, "operating-expense", id.Value);
        if (path == "/api/students" && http.Request.Method == "POST") return ScopeTarget.UnlinkedTarget;
        if (path.StartsWith("/api/students/") && http.Request.Method is "PUT" or "PATCH" or "POST" && id is not null)
            return await AuditTrashScopeResolver.EntityTargetAsync(connection, "student", id.Value);
        if (path == "/api/teachers" && http.Request.Method == "POST") return ScopeTarget.UnlinkedTarget;
        if (path.StartsWith("/api/teachers/") && http.Request.Method is "PUT" or "POST" or "PATCH" && id is not null)
            return await AuditTrashScopeResolver.EntityTargetAsync(connection, "teacher", id.Value);
        if (path == "/api/circles" && http.Request.Method == "POST")
            return await AcademicScopeResolver.ResolveCircleWriteAsync(connection, context, false);
        if (path == "/api/circles/with-schedule" && http.Request.Method == "POST")
            return await AcademicScopeResolver.ResolveCircleWriteAsync(connection, context, true);
        if (path.StartsWith("/api/circles/") && http.Request.Method == "PUT" && id is not null)
            return await AuditTrashScopeResolver.EntityTargetAsync(connection, "circle", id.Value);
        if (path == "/api/enrollments" && http.Request.Method == "POST")
            return await AcademicScopeResolver.ResolveEnrollmentWriteAsync(connection, context, "EnrollmentWriteRequest");
        if (path == "/api/circle-enrollments/bulk" && http.Request.Method == "POST")
            return await AcademicScopeResolver.ResolveEnrollmentWriteAsync(connection, context, "BulkEnrollmentWriteRequest");
        if (path.StartsWith("/api/enrollments/") && http.Request.Method == "PATCH" && id is not null)
            return await AuditTrashScopeResolver.EntityTargetAsync(connection, "enrollment", id.Value);
        if (path is "/api/admin/payroll/lock" or "/api/admin/payroll/unlock") return ScopeTarget.UnlinkedTarget;
        return null;
    }

    private static Guid? RouteGuid(HttpContext http, string key) => Guid.TryParse(http.Request.RouteValues[key]?.ToString(), out var id) ? id : null;

    /// <summary>
    /// Receipt uploads carry the charge id in the multipart form, not the route. The filter runs
    /// before binding, so the resolver reads (and caches) the form itself; a scoped user without a
    /// resolvable charge target is denied by the caller's fail-closed branch.
    /// </summary>
    private static async Task<ScopeTarget?> ResolveReceiptPaymentAsync(
        NpgsqlConnection connection, EndpointFilterInvocationContext context, CancellationToken ct)
    {
        var request = context.Arguments.OfType<HttpRequest>().FirstOrDefault();
        if (request is null || !request.HasFormContentType) return null;
        var form = await request.ReadFormAsync(ct);
        return Guid.TryParse(form["monthlyChargeId"], out var chargeId) && chargeId != Guid.Empty
            ? await AuditTrashScopeResolver.EntityTargetAsync(connection, "monthly-charge", chargeId)
            : null;
    }
}
