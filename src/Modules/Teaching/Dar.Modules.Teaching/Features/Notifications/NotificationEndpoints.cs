using System.Security.Claims;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Notifications;

public static class NotificationEndpoints
{
    public static IEndpointRouteBuilder MapNotificationEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/notifications").WithTags("notifications").RequireAuthorization();
        group.MapGet("", List).WithName("ListNotifications");
        group.MapPost("/{id:guid}/read", MarkRead).WithName("ReadNotification");
        group.MapPost("/read-all", MarkAllRead).WithName("ReadAllNotifications");
        group.MapPost("/{id:guid}/resolve", Resolve).RequireAuthorization("attendance.correct").WithName("ResolveNotification");
        return app;
    }

    private static async Task<IResult> List(
        string? status,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var userId = TeachingPrincipal.UserId(principal);
        if (userId == Guid.Empty) return Results.Unauthorized();
        var isSupervisor = TeachingPrincipal.Has(principal, "supervisor.portal");
        var isAdmin = TeachingPrincipal.Has(principal, "users.manage");
        var filter = string.IsNullOrWhiteSpace(status) ? "open" : status.Trim().ToLowerInvariant();
        if (filter is not ("open" or "resolved" or "all"))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["status"] = ["استخدم open أو resolved أو all."] });

        var rows = new List<object>();
        int openCount;
        int unreadCount;
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using (var counts = new NpgsqlCommand("""
            SELECT COUNT(*) FILTER (WHERE n.status='open') AS open_count,
                   COUNT(*) FILTER (WHERE n.status='open' AND nr.read_at IS NULL) AS unread_count
            FROM notifications n
            LEFT JOIN notification_reads nr ON nr.notification_id=n.id AND nr.user_id=@user
            WHERE (n.user_id=@user OR (@supervisor AND n.role_scope='supervisor') OR (@admin AND n.role_scope='admin'));
            """, connection))
        {
            counts.Parameters.AddWithValue("user", userId);
            counts.Parameters.AddWithValue("supervisor", isSupervisor);
            counts.Parameters.AddWithValue("admin", isAdmin);
            await using var reader = await counts.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            openCount = (int)reader.GetInt64(0);
            unreadCount = (int)reader.GetInt64(1);
        }

        await using (var command = new NpgsqlCommand("""
            SELECT n.id, n.category, n.status, n.severity, n.title, n.body, n.action_url,
                   n.created_at, n.resolved_at, n.resolution_note, nr.read_at
            FROM notifications n
            LEFT JOIN notification_reads nr ON nr.notification_id=n.id AND nr.user_id=@user
            WHERE (n.user_id=@user OR (@supervisor AND n.role_scope='supervisor') OR (@admin AND n.role_scope='admin'))
              AND (@status='all' OR n.status=@status)
            ORDER BY (n.status='open') DESC, n.created_at DESC
            LIMIT 200;
            """, connection))
        {
            command.Parameters.AddWithValue("user", userId);
            command.Parameters.AddWithValue("supervisor", isSupervisor);
            command.Parameters.AddWithValue("admin", isAdmin);
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

        return Results.Ok(new { counts = new { open = openCount, unread = unreadCount }, notifications = rows });
    }

    private static async Task<IResult> MarkRead(
        Guid id,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var userId = TeachingPrincipal.UserId(principal);
        if (userId == Guid.Empty) return Results.Unauthorized();
        if (!await IsVisibleAsync(dataSource, id, principal, ct)) return Results.NotFound();

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            INSERT INTO notification_reads(notification_id, user_id) VALUES(@notification, @user)
            ON CONFLICT (notification_id, user_id) DO NOTHING;
            """, connection);
        command.Parameters.AddWithValue("notification", id);
        command.Parameters.AddWithValue("user", userId);
        await command.ExecuteNonQueryAsync(ct);
        return Results.Ok(new { id, read = true });
    }

    private static async Task<IResult> MarkAllRead(
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var userId = TeachingPrincipal.UserId(principal);
        if (userId == Guid.Empty) return Results.Unauthorized();
        var isSupervisor = TeachingPrincipal.Has(principal, "supervisor.portal");
        var isAdmin = TeachingPrincipal.Has(principal, "users.manage");

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            INSERT INTO notification_reads(notification_id, user_id)
            SELECT n.id, @user
            FROM notifications n
            WHERE (n.user_id=@user OR (@supervisor AND n.role_scope='supervisor') OR (@admin AND n.role_scope='admin'))
            ON CONFLICT (notification_id, user_id) DO NOTHING;
            """, connection);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("supervisor", isSupervisor);
        command.Parameters.AddWithValue("admin", isAdmin);
        var count = await command.ExecuteNonQueryAsync(ct);
        return Results.Ok(new { read = count });
    }

    private static async Task<IResult> Resolve(
        Guid id,
        ResolveNotificationRequest request,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Note))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["note"] = ["اكتب سبب إغلاق التنبيه."] });
        if (!await IsVisibleAsync(dataSource, id, principal, ct)) return Results.NotFound();

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        string category;
        string status;
        await using (var read = new NpgsqlCommand("SELECT category, status FROM notifications WHERE id=@id FOR UPDATE;", connection, transaction))
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

        var userId = TeachingPrincipal.UserId(principal);
        await using (var update = new NpgsqlCommand("""
            UPDATE notifications
            SET status='resolved', resolved_at=now(), resolved_by=@actor, resolution_note=@note
            WHERE id=@id;
            """, connection, transaction))
        {
            update.Parameters.AddWithValue("actor", userId);
            update.Parameters.AddWithValue("note", request.Note.Trim());
            update.Parameters.AddWithValue("id", id);
            await update.ExecuteNonQueryAsync(ct);
        }
        await TeachingAudit.WriteAsync(connection, transaction, principal, "notification.resolve", "notification", id,
            new { note = request.Note.Trim() }, $"/api/v1/notifications/{id}/resolve", "POST", ct);
        await transaction.CommitAsync(ct);
        return Results.Ok(new { id, status = "resolved", alreadyResolved = false });
    }

    private static async Task<bool> IsVisibleAsync(
        NpgsqlDataSource dataSource,
        Guid id,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var userId = TeachingPrincipal.UserId(principal);
        var isSupervisor = TeachingPrincipal.Has(principal, "supervisor.portal");
        var isAdmin = TeachingPrincipal.Has(principal, "users.manage");
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT EXISTS(
                SELECT 1 FROM notifications
                WHERE id=@id
                  AND (user_id=@user OR (@supervisor AND role_scope='supervisor') OR (@admin AND role_scope='admin'))
            );
            """, connection);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("supervisor", isSupervisor);
        command.Parameters.AddWithValue("admin", isAdmin);
        return (bool)(await command.ExecuteScalarAsync(ct) ?? false);
    }
}
