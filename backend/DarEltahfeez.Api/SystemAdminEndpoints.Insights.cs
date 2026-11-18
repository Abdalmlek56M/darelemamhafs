using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class SystemAdminEndpoints
{
    internal static void MapInsights(WebApplication app)
    {
        app.MapGet("/api/admin/notifications", async Task<IResult> (string? status, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var filter = string.IsNullOrWhiteSpace(status) ? "open" : status.Trim().ToLowerInvariant();
            if (filter is not ("open" or "resolved" or "all"))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["status"] = ["استخدم open أو resolved أو all."] });
            if (ActorId(principal) is not Guid userId) return Results.Unauthorized();
            var canFinance = CanReadFinance(principal);

            var rows = new List<object>();
            int openCount, unreadCount, resolvedCount;
            await using var connection = await db.OpenConnectionAsync(ct);
            await using (var counts = new NpgsqlCommand("""
                SELECT COUNT(*) FILTER (WHERE n.status='open') AS open_count,
                       COUNT(*) FILTER (WHERE n.status='open' AND nr.read_at IS NULL) AS unread_count,
                       COUNT(*) FILTER (WHERE n.status='resolved') AS resolved_count
                FROM notifications n
                LEFT JOIN notification_reads nr ON nr.notification_id=n.id AND nr.user_id=@user
                WHERE (n.user_id=@user OR n.role_scope IN ('supervisor','admin'))
                  AND (n.category <> 'payment' OR @canFinance);
                """, connection))
            {
                counts.Parameters.AddWithValue("user", userId);
                counts.Parameters.AddWithValue("canFinance", canFinance);
                await using var reader = await counts.ExecuteReaderAsync(ct);
                await reader.ReadAsync(ct);
                openCount = (int)reader.GetInt64(0);
                unreadCount = (int)reader.GetInt64(1);
                resolvedCount = (int)reader.GetInt64(2);
            }

            await using (var command = new NpgsqlCommand("""
                SELECT n.id, n.category, n.status, n.severity, n.title, n.body, n.action_url,
                       n.created_at, n.resolved_at, n.resolution_note, nr.read_at
                FROM notifications n
                LEFT JOIN notification_reads nr ON nr.notification_id=n.id AND nr.user_id=@user
                WHERE (n.user_id=@user OR n.role_scope IN ('supervisor','admin'))
                  AND (n.category <> 'payment' OR @canFinance)
                  AND (@status='all' OR n.status=@status)
                ORDER BY (n.status='open') DESC, n.created_at DESC
                LIMIT 300;
                """, connection))
            {
                command.Parameters.AddWithValue("user", userId);
                command.Parameters.AddWithValue("canFinance", canFinance);
                command.Parameters.AddWithValue("status", filter);
                await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    rows.Add(new
                    {
                        id = reader.GetGuid(0),
                        category = reader.GetString(1),
                        status = reader.GetString(2),
                        severity = reader.GetString(3),
                        title = reader.GetString(4),
                        body = reader.GetString(5),
                        actionUrl = reader.IsDBNull(6) ? null : reader.GetString(6),
                        createdAt = reader.GetFieldValue<DateTimeOffset>(7),
                        resolvedAt = reader.IsDBNull(8) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(8),
                        resolutionNote = reader.IsDBNull(9) ? null : reader.GetString(9),
                        readAt = reader.IsDBNull(10) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(10)
                    });
                }
            }

            return Results.Ok(new { counts = new { open = openCount, unread = unreadCount, resolved = resolvedCount }, notifications = rows });
        }).RequireAuthorization("dashboard.read");

        app.MapPost("/api/admin/notifications/{id:guid}/read", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (ActorId(principal) is not Guid userId) return Results.Unauthorized();
            if (!await IsNotificationVisibleAsync(db, id, principal, ct)) return Results.NotFound();
            await using var command = db.CreateCommand("""
                INSERT INTO notification_reads(notification_id,user_id) VALUES(@id,@user)
                ON CONFLICT (notification_id,user_id) DO NOTHING;
                """);
            command.Parameters.AddWithValue("id", id);
            command.Parameters.AddWithValue("user", userId);
            await command.ExecuteNonQueryAsync(ct);
            return Results.Ok(new { id, read = true });
        }).RequireAuthorization("dashboard.read");

        app.MapPost("/api/admin/notifications/read-all", async Task<IResult> (ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (ActorId(principal) is not Guid userId) return Results.Unauthorized();
            var canFinance = CanReadFinance(principal);
            await using var command = db.CreateCommand("""
                INSERT INTO notification_reads(notification_id,user_id)
                SELECT n.id,@user FROM notifications n
                WHERE (n.user_id=@user OR n.role_scope IN ('supervisor','admin'))
                  AND (n.category <> 'payment' OR @canFinance)
                  AND n.status='open'
                ON CONFLICT (notification_id,user_id) DO NOTHING;
                """);
            command.Parameters.AddWithValue("user", userId);
            command.Parameters.AddWithValue("canFinance", canFinance);
            var count = await command.ExecuteNonQueryAsync(ct);
            return Results.Ok(new { read = count });
        }).RequireAuthorization("dashboard.read");

        app.MapPost("/api/admin/notifications/{id:guid}/resolve", async Task<IResult> (Guid id, ResolveNotificationRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!CanResolveNotifications(principal))
                return Results.Json(new { message = "لا تملك صلاحية إغلاق التنبيهات." }, statusCode: StatusCodes.Status403Forbidden);
            if (string.IsNullOrWhiteSpace(request.Note))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["note"] = ["اكتب سبب إغلاق التنبيه."] });
            if (!await IsNotificationVisibleAsync(db, id, principal, ct)) return Results.NotFound();

            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            string category, status;
            await using (var read = new NpgsqlCommand("SELECT category,status FROM notifications WHERE id=@id FOR UPDATE;", connection, transaction))
            {
                read.Parameters.AddWithValue("id", id);
                await using var reader = await read.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct)) return Results.NotFound();
                category = reader.GetString(0);
                status = reader.GetString(1);
            }
            if (category == "payment")
                return Results.Conflict(new { message = "تنبيه الاشتراك يُغلق تلقائيًا عند سداد المبلغ بالكامل." });
            if (status == "resolved")
            {
                await transaction.CommitAsync(ct);
                return Results.Ok(new { id, status = "resolved", alreadyResolved = true });
            }

            var note = request.Note.Trim();
            await using (var update = new NpgsqlCommand("""
                UPDATE notifications SET status='resolved',resolved_at=now(),resolved_by=@actor,resolution_note=@note
                WHERE id=@id;
                """, connection, transaction))
            {
                update.Parameters.AddWithValue("actor", DbGuid(ActorId(principal)));
                update.Parameters.AddWithValue("note", note);
                update.Parameters.AddWithValue("id", id);
                await update.ExecuteNonQueryAsync(ct);
            }
            await InsertAuditAsync(db, ActorId(principal), principal.FindFirstValue("display_name"), "notification.resolve", "notification", id,
                null, JsonSerializer.Serialize(new { note }), $"/api/admin/notifications/{id}/resolve", "POST", false, ct);
            await transaction.CommitAsync(ct);
            return Results.Ok(new { id, status = "resolved", alreadyResolved = false });
        }).RequireAuthorization();

        app.MapGet("/api/admin/charge-audit", async Task<IResult> (string? month, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!DateOnly.TryParseExact($"{month}-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var billingMonth)
                || billingMonth > DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(1)))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });

            var rows = new List<object>();
            await using var connection = await db.OpenConnectionAsync(ct);
            await using (var command = new NpgsqlCommand("""
                SELECT mc.id, ce.id, s.full_name, s.student_code, c.name,
                       mc.amount_due, ce.agreed_monthly_fee, COALESCE(p.paid,0) AS paid
                FROM monthly_charges mc
                JOIN circle_enrollments ce ON ce.id=mc.enrollment_id AND ce.is_trashed=FALSE
                JOIN students s ON s.id=ce.student_id AND s.is_trashed=FALSE
                JOIN circles c ON c.id=ce.circle_id AND c.is_trashed=FALSE
                LEFT JOIN (
                    SELECT monthly_charge_id, SUM(amount) AS paid
                    FROM payments WHERE is_trashed=FALSE GROUP BY monthly_charge_id
                ) p ON p.monthly_charge_id=mc.id
                WHERE mc.billing_month=@month AND mc.is_trashed=FALSE
                  AND mc.amount_due <> ce.agreed_monthly_fee
                ORDER BY c.name, s.full_name;
                """, connection))
            {
                command.Parameters.AddWithValue("month", billingMonth);
                await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    var amountDue = reader.GetDecimal(5);
                    var agreedFee = reader.GetDecimal(6);
                    var paid = reader.GetDecimal(7);
                    rows.Add(new
                    {
                        chargeId = reader.GetGuid(0),
                        enrollmentId = reader.GetGuid(1),
                        studentName = reader.GetString(2),
                        studentCode = reader.GetString(3),
                        circleName = reader.GetString(4),
                        amountDue,
                        agreedFee,
                        paid,
                        difference = agreedFee - amountDue,
                        balanceAfterCorrection = agreedFee - paid
                    });
                }
            }

            return Results.Ok(new
            {
                month = billingMonth.ToString("yyyy-MM", CultureInfo.InvariantCulture),
                count = rows.Count,
                rows
            });
        }).RequireAuthorization("finance.read");

        app.MapGet("/api/admin/teacher-notes", async Task<IResult> (string? kind, Guid? teacherId, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var filterKind = string.IsNullOrWhiteSpace(kind) ? "all" : kind.Trim().ToLowerInvariant();
            if (filterKind is not ("all" or "session" or "student"))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["kind"] = ["استخدم all أو session أو student."] });

            var rows = new List<object>();
            await using var connection = await db.OpenConnectionAsync(ct);
            await using (var command = new NpgsqlCommand("""
                SELECT 'session' AS kind, ta.teacher_id, t.full_name, c.name, ta.session_date,
                       ta.note, ta.marked_at, NULL::text AS student_name, NULL::text AS student_code
                FROM teacher_attendance ta
                JOIN teachers t ON t.id=ta.teacher_id AND t.is_trashed=FALSE
                JOIN circles c ON c.id=ta.circle_id AND c.is_trashed=FALSE
                WHERE ta.is_trashed=FALSE
                  AND ta.note IS NOT NULL AND btrim(ta.note)<>''
                  AND (@teacher::uuid IS NULL OR t.id=@teacher)
                  AND (@kind='all' OR @kind='session')

                UNION ALL

                SELECT 'student' AS kind, c.teacher_id, t.full_name, c.name, sa.session_date,
                       sa.note, sa.marked_at, s.full_name, s.student_code
                FROM student_attendance sa
                JOIN circle_enrollments ce ON ce.id=sa.enrollment_id AND ce.is_trashed=FALSE
                JOIN students s ON s.id=ce.student_id AND s.is_trashed=FALSE
                JOIN circles c ON c.id=ce.circle_id AND c.is_trashed=FALSE
                JOIN teachers t ON t.id=c.teacher_id AND t.is_trashed=FALSE
                WHERE sa.is_trashed=FALSE
                  AND sa.note IS NOT NULL AND btrim(sa.note)<>''
                  AND (@teacher::uuid IS NULL OR t.id=@teacher)
                  AND (@kind='all' OR @kind='student')

                ORDER BY session_date DESC, marked_at DESC
                LIMIT 250;
                """, connection))
            {
                command.Parameters.AddWithValue("teacher", (object?)teacherId ?? DBNull.Value);
                command.Parameters.AddWithValue("kind", filterKind);
                await using var reader = await command.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    rows.Add(new
                    {
                        kind = reader.GetString(0),
                        teacherId = reader.GetGuid(1),
                        teacherName = reader.GetString(2),
                        circleName = reader.GetString(3),
                        date = reader.GetFieldValue<DateOnly>(4),
                        note = reader.GetString(5),
                        markedAt = reader.GetFieldValue<DateTimeOffset>(6),
                        studentName = reader.IsDBNull(7) ? null : reader.GetString(7),
                        studentCode = reader.IsDBNull(8) ? null : reader.GetString(8)
                    });
                }
            }

            var teachers = new List<object>();
            await using (var teacherCommand = new NpgsqlCommand("SELECT id,full_name FROM teachers WHERE is_trashed=FALSE ORDER BY full_name;", connection))
            {
                await using var reader = await teacherCommand.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct)) teachers.Add(new { id = reader.GetGuid(0), name = reader.GetString(1) });
            }

            string? banner = null;
            await using (var bannerCommand = new NpgsqlCommand("SELECT teacher_notes_banner FROM school_settings WHERE id=1 AND teacher_notes_banner_active=TRUE;", connection))
            {
                if (await bannerCommand.ExecuteScalarAsync(ct) is string text && !string.IsNullOrWhiteSpace(text)) banner = text.Trim();
            }

            return Results.Ok(new { count = rows.Count, notes = rows, teachers, banner });
        }).RequireAuthorization("teachers.read");
    }

    private static bool CanResolveNotifications(ClaimsPrincipal principal) =>
        principal.HasClaim("permission", "attendance.correct") || principal.HasClaim("permission", "users.manage");

    private static async Task<bool> IsNotificationVisibleAsync(NpgsqlDataSource db, Guid id, ClaimsPrincipal principal, CancellationToken ct)
    {
        if (ActorId(principal) is not Guid userId) return false;
        await using var command = db.CreateCommand("""
            SELECT EXISTS(
                SELECT 1 FROM notifications n
                WHERE n.id=@id
                  AND (n.user_id=@user OR n.role_scope IN ('supervisor','admin'))
                  AND (n.category <> 'payment' OR @canFinance)
            );
            """);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("canFinance", CanReadFinance(principal));
        return (bool)(await command.ExecuteScalarAsync(ct) ?? false);
    }
}

public sealed record ResolveNotificationRequest(string? Note);
