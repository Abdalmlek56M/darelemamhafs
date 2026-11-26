namespace DarEltahfeez.Api.Services;

/// <summary>
/// FINAL 1.1: the trash auto-purge method existed with zero callers. This worker runs it on
/// a timer so the retention setting (school_settings.trash_retention_days, materialized as
/// trash_items.expires_at when a record is moved to trash) is actually enforced.
/// Financial records are still retained by SystemAdminService.FinancialTrashTypes.
/// </summary>
public sealed class TrashPurgeWorker(
    IServiceScopeFactory scopeFactory,
    IConfiguration configuration,
    ILogger<TrashPurgeWorker> logger) : BackgroundService
{
    private static readonly TimeSpan StartupDelay = TimeSpan.FromMinutes(2);
    private const int DefaultIntervalMinutes = 360;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var configured = configuration.GetValue<int?>("Trash:PurgeIntervalMinutes") ?? DefaultIntervalMinutes;
        var interval = TimeSpan.FromMinutes(configured is >= 5 and <= 10080 ? configured : DefaultIntervalMinutes);

        try { await Task.Delay(StartupDelay, stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var service = scope.ServiceProvider.GetRequiredService<SystemAdminService>();
                await service.PurgeExpiredTrashAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Trash auto-purge iteration failed.");
            }

            try { await Task.Delay(interval, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }
}
