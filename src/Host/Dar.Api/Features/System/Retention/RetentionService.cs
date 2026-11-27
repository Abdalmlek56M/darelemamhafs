using Npgsql;

namespace Dar.Api.Features.System.Retention;

/// <summary>
/// FINAL 2.4: bounded retention for auth/session/notification/communication tables.
/// audit_log is never pruned (money/security history), and only rows that are clearly past
/// their configured lifetime are deleted.
/// </summary>
public sealed class DataRetentionService(NpgsqlDataSource dataSource, IConfiguration configuration, ILogger<DataRetentionService> logger)
{
    public sealed record RetentionResult(int Sessions, int Otps, int Notifications, int CommunicationLog);

    public async Task<RetentionResult> RunAsync(CancellationToken ct)
    {
        var sessionDays = Math.Clamp(configuration.GetValue("Retention:SessionDays", 7), 1, 3650);
        var otpDays = Math.Clamp(configuration.GetValue("Retention:OtpDays", 7), 1, 3650);
        var notificationDays = Math.Clamp(configuration.GetValue("Retention:NotificationDays", 90), 1, 3650);
        var communicationDays = Math.Clamp(configuration.GetValue("Retention:CommunicationDays", 365), 1, 3650);

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        async Task<int> DeleteAsync(string sql, int days)
        {
            await using var command = new NpgsqlCommand(sql, connection, transaction);
            command.Parameters.AddWithValue("days", days);
            return await command.ExecuteNonQueryAsync(ct);
        }

        var sessions = await DeleteAsync(
            "DELETE FROM auth_sessions WHERE expires_at < now() - (@days || ' days')::interval;", sessionDays);
        var otps = await DeleteAsync(
            "DELETE FROM auth_email_otps WHERE expires_at < now() - (@days || ' days')::interval OR consumed_at IS NOT NULL AND consumed_at < now() - (@days || ' days')::interval;", otpDays);
        var notifications = await DeleteAsync("""
            DELETE FROM notifications
            WHERE (status = 'resolved' AND resolved_at IS NOT NULL AND resolved_at < now() - (@days || ' days')::interval)
               OR (expires_at IS NOT NULL AND expires_at < now())
            """, notificationDays);
        var communication = await DeleteAsync(
            "DELETE FROM communication_log WHERE created_at < now() - (@days || ' days')::interval;", communicationDays);

        await transaction.CommitAsync(ct);
        var result = new RetentionResult(sessions, otps, notifications, communication);
        logger.LogInformation("Retention run: {@Result}", result);
        return result;
    }
}

/// <summary>FINAL 2.4: the scheduled retention worker (manual trigger lives in the endpoint).</summary>
public sealed class DataRetentionWorker(IServiceScopeFactory scopeFactory, ILogger<DataRetentionWorker> logger) : BackgroundService
{
    private static readonly TimeSpan StartupDelay = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan Interval = TimeSpan.FromHours(24);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(StartupDelay, stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var service = scope.ServiceProvider.GetRequiredService<DataRetentionService>();
                await service.RunAsync(stoppingToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogWarning(exception, "Scheduled retention run failed");
            }

            try { await Task.Delay(Interval, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }
}

public static class RetentionEndpoints
{
    public static IEndpointRouteBuilder MapRetentionEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/system/retention/run", async (DataRetentionService service, CancellationToken ct) =>
        {
            var result = await service.RunAsync(ct);
            return Results.Ok(result);
        }).RequireAuthorization("settings.manage");
        return app;
    }
}
