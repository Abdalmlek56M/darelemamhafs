using System.Security.Claims;
using Dar.Common.Pagination;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class SystemAdminEndpoints
{
    private static string? ResetCandidateSql(string entity) => entity switch
    {
        "teacher-attendance" => """
            SELECT a.id, concat(t.full_name,' · ',c.name,' · ',to_char(a.session_date,'DD/MM/YYYY'),' · ',a.status)
            FROM teacher_attendance a JOIN teachers t ON t.id=a.teacher_id JOIN circles c ON c.id=a.circle_id
            WHERE a.is_trashed=FALSE
            """,
        "student-attendance" => """
            SELECT sa.id, concat(s.full_name,' · ',c.name,' · ',to_char(sa.session_date,'DD/MM/YYYY'),' · ',sa.status)
            FROM student_attendance sa JOIN circle_enrollments ce ON ce.id=sa.enrollment_id
            JOIN students s ON s.id=ce.student_id JOIN circles c ON c.id=ce.circle_id
            WHERE sa.is_trashed=FALSE
            """,
        "schedule-slots" => """
            SELECT ss.id, concat(c.name,' · ',CASE ss.day_of_week WHEN 0 THEN 'الأحد' WHEN 1 THEN 'الاثنين' WHEN 2 THEN 'الثلاثاء' WHEN 3 THEN 'الأربعاء' WHEN 4 THEN 'الخميس' WHEN 5 THEN 'الجمعة' ELSE 'السبت' END,' · ',to_char(ss.starts_at,'HH24:MI'))
            FROM circle_schedule_slots ss JOIN circles c ON c.id=ss.circle_id
            WHERE ss.is_trashed=FALSE
            """,
        "monthly-charges" => """
            SELECT mc.id, concat(s.full_name,' · ',c.name,' · ',mc.billing_month::text)
            FROM monthly_charges mc JOIN circle_enrollments ce ON ce.id=mc.enrollment_id
            JOIN students s ON s.id=ce.student_id JOIN circles c ON c.id=ce.circle_id
            WHERE mc.is_trashed=FALSE AND mc.voided_at IS NULL
            """,
        "payments" => """
            SELECT p.id, concat(s.full_name,' · ',c.name,' · ',to_char(p.paid_at,'DD/MM/YYYY'))
            FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id
            JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN students s ON s.id=ce.student_id JOIN circles c ON c.id=ce.circle_id
            WHERE p.is_trashed=FALSE AND p.voided_at IS NULL
            """,
        "advertising-expenses" => """
            SELECT a.id, concat(c.name,' · ',COALESCE(a.platform,'إعلان'),' · ',to_char(a.start_date,'DD/MM/YYYY'))
            FROM advertising_expenses a JOIN circles c ON c.id=a.circle_id
            WHERE a.is_trashed=FALSE
            """,
        "operating-expenses" => """
            SELECT o.id, concat(to_char(o.expense_date,'DD/MM/YYYY'),' · ',COALESCE(c.name,'مصروف عام للدار'),' · مصروف تشغيلي')
            FROM operating_expenses o LEFT JOIN circles c ON c.id=o.circle_id
            WHERE o.is_trashed=FALSE
            """,
        "general-operating-expenses" => """
            SELECT o.id, concat(to_char(o.expense_date,'DD/MM/YYYY'),' · مصروف عام للدار · مصروف تشغيلي')
            FROM operating_expenses o WHERE o.circle_id IS NULL AND o.is_trashed=FALSE
            """,
        "collection-reports" => """
            SELECT id, concat(title,' · ',billing_month::text)
            FROM collection_reports WHERE is_trashed=FALSE
            """,
        _ => null
    };

    internal static void MapPagedResetCandidates(WebApplication app)
    {
        app.MapGet("/api/admin/reset-candidates/{entity}", async Task<IResult> (string entity, int? page, int? pageSize, HttpContext http, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var baseSql = ResetCandidateSql(entity);
            if (baseSql is null) return Results.NotFound(new { message = "نوع قوائم إعادة الضبط غير معروف." });
            // Security review (A1/A8): each paged list requires the domain read permission and scope.
            var permission = ResetCandidateReadPermission(entity);
            if (permission is null) return Results.NotFound(new { message = "نوع قوائم إعادة الضبط غير معروف." });
            if (!principal.HasClaim("permission", permission))
                return Results.Json(new { message = "عرض قائمة التصفير يتطلب صلاحية القراءة المناسبة." },
                    statusCode: StatusCodes.Status403Forbidden);
            Dar.Common.Permissions.AccessScope scope;
            await using (var scopeConnection = await db.OpenConnectionAsync(ct))
                scope = await Dar.Common.Permissions.ScopeLoader.LoadAsync(scopeConnection, principal, ct);
            var scoped = !scope.All;
            var paged = page is not null || pageSize is not null;
            var paging = new PageRequest(page, pageSize);
            // School-wide (unlinked) candidates are outside every circle/teacher scope: fail closed.
            if (scoped && entity is "general-operating-expenses" or "collection-reports")
            {
                PaginationHeaderWriter.Write(http.Response, 0, paging, 0, paged);
                return Results.Ok(Array.Empty<object>());
            }
            var filter = scoped
                ? " AND (c.id = ANY(@scopeCircles) OR c.teacher_id = ANY(@scopeTeachers))"
                : "";
            var query = $"SELECT q.*, COUNT(*) OVER() AS total FROM ({baseSql}{filter}) q ORDER BY q.id";
            if (paged) query += " LIMIT @take OFFSET @skip";
            await using var cmd = db.CreateCommand(query);
            if (scoped)
            {
                cmd.Parameters.AddWithValue("scopeCircles", scope.CircleIds);
                cmd.Parameters.AddWithValue("scopeTeachers", scope.TeacherIds);
            }
            if (paged)
            {
                cmd.Parameters.AddWithValue("take", paging.PageSize);
                cmd.Parameters.AddWithValue("skip", paging.Offset);
            }
            var rows = new List<object>();
            long total = 0;
            await using (var reader = await cmd.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                {
                    total = reader.ReadTotal();
                    rows.Add(new { id = reader.GetGuid(0), label = reader.IsDBNull(1) ? "سجل" : reader.GetString(1) });
                }
            }
            total = await PaginationRules.EnsureTotalAsync(cmd, total, paged, ct);
            PaginationHeaderWriter.Write(http.Response, total, paging, rows.Count, paged);
            return Results.Ok(rows);
        }).RequireAuthorization("trash.manage");
    }
}