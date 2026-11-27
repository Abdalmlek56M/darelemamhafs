using System.Security.Claims;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class SystemAdminEndpoints
{
    /// <summary>
    /// Security review (A1/A8): the reset-candidate lists contain student/circle names plus
    /// billing and payment labels for every circle. They need the domain read permissions in
    /// addition to trash.manage, and the caller's scope filter.
    /// </summary>
    private static IResult? RequireResetCandidatePermissions(ClaimsPrincipal principal)
    {
        if (!principal.HasClaim("permission", "students.read"))
            return Results.Json(new { message = "عرض قوائم التصفير يتطلب صلاحية عرض بيانات الطلاب." },
                statusCode: StatusCodes.Status403Forbidden);
        if (!principal.HasClaim("permission", "finance.read"))
            return Results.Json(new { message = "عرض قوائم التصفير يتطلب صلاحية عرض البيانات المالية." },
                statusCode: StatusCodes.Status403Forbidden);
        return null;
    }

    /// <summary>The read permission each paged reset-candidate list requires.</summary>
    private static string? ResetCandidateReadPermission(string entity) => entity switch
    {
        "teacher-attendance" or "student-attendance" => "attendance.read",
        "schedule-slots" => "schedule.read",
        "monthly-charges" or "payments" or "advertising-expenses" or "operating-expenses"
            or "general-operating-expenses" or "collection-reports" => "finance.read",
        _ => null
    };
}
