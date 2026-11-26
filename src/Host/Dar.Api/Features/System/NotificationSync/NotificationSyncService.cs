using Npgsql;

namespace Dar.Api.Features.System.NotificationSync;

/// <summary>
/// Creates/refreshes unpaid-subscription notifications on a schedule.
/// GET endpoints never write notifications.
/// </summary>
public sealed class NotificationSyncService(
    IConfiguration configuration,
    IServiceProvider services,
    ILogger<NotificationSyncService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(configuration.GetConnectionString("Default")))
            return;

        await Task.Delay(TimeSpan.FromSeconds(45), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var dataSource = services.GetRequiredService<NpgsqlDataSource>();
                var count = await SyncAsync(dataSource, stoppingToken);
                logger.LogInformation("Unpaid notification sync completed: {Count} rows refreshed.", count);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogError(exception, "Unpaid notification sync failed.");
            }

            await Task.Delay(TimeSpan.FromHours(6), stoppingToken);
        }
    }

    public static async Task<int> SyncAsync(NpgsqlDataSource dataSource, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            INSERT INTO notifications(
                user_id, role_scope, category, status, severity, title, body,
                entity_type, entity_id, action_url, dedupe_key, scope_circle_id, scope_teacher_id)
            SELECT NULL, 'supervisor', 'payment', 'open', 'warning', 'اشتراك غير مدفوع',
                   s.full_name || ' — ' || c.name || ' · متابعة تحصيل مطلوبة',
                   'monthly_charge', mc.id, '/supervisor/unpaid', 'unpaid:' || mc.id, c.id, c.teacher_id
            FROM monthly_charges mc
            JOIN circle_enrollments ce ON ce.id = mc.enrollment_id AND ce.is_trashed = FALSE
            JOIN students s ON s.id = ce.student_id AND s.is_trashed = FALSE
            JOIN circles c ON c.id = ce.circle_id AND c.is_trashed = FALSE
            LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(amount), 0) AS paid
                FROM payments
                WHERE monthly_charge_id = mc.id AND is_trashed = FALSE AND voided_at IS NULL
            ) p ON TRUE
            WHERE mc.is_trashed = FALSE
              AND mc.voided_at IS NULL
              AND mc.amount_due > COALESCE(p.paid, 0)
              AND (now() AT TIME ZONE 'Africa/Cairo')::date >= (mc.billing_month + INTERVAL '1 month - 1 day')
            ON CONFLICT (dedupe_key) DO UPDATE SET
                -- FINAL 1.13: a scheduled refresh must not reopen an item the supervisor resolved.
                status = CASE WHEN notifications.status = 'resolved' THEN 'resolved' ELSE 'open' END,
                resolved_at = CASE WHEN notifications.status = 'resolved' THEN notifications.resolved_at ELSE NULL END,
                resolved_by = CASE WHEN notifications.status = 'resolved' THEN notifications.resolved_by ELSE NULL END,
                resolution_note = CASE WHEN notifications.status = 'resolved' THEN notifications.resolution_note ELSE NULL END,
                title=EXCLUDED.title, body=EXCLUDED.body, action_url=EXCLUDED.action_url,
                scope_circle_id=EXCLUDED.scope_circle_id, scope_teacher_id=EXCLUDED.scope_teacher_id;
            """, connection);
        return await command.ExecuteNonQueryAsync(ct);
    }
}
