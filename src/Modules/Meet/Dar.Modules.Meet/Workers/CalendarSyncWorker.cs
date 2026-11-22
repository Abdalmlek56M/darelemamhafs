using Dar.Modules.Meet.Application;
using Dar.Modules.Meet.Infrastructure;
using Dar.Modules.Meet.Persistence;

namespace Dar.Modules.Meet.Workers;

/// <summary>
/// Polls Google Calendar for changes (ADR-0007 §3). Incremental sync uses the stored
/// syncToken; the service escalates to a full resync every FullSyncHours or on 410 Gone.
/// A failed token disables the loop (fail-closed) until the owner reconnects Google.
/// </summary>
public sealed class CalendarSyncWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<CalendarSyncWorker> logger) : BackgroundService
{
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan IdleDelay = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan FailureDelay = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan MaxBackoff = TimeSpan.FromMinutes(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(StartupDelay, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            var delay = IdleDelay;
            try
            {
                using var scope = scopeFactory.CreateScope();
                var provider = scope.ServiceProvider;
                var options = provider.GetRequiredService<IOptions<MeetOptions>>().Value;
                var crypto = provider.GetRequiredService<MeetCrypto>();

                if (!options.IsConfigured || !crypto.IsReady)
                {
                    logger.LogInformation("Meet calendar sync idle: module prerequisites are not configured.");
                }
                else
                {
                    var repository = provider.GetRequiredService<MeetCalendarRepository>();
                    var account = await repository.GetActiveAccountAsync(stoppingToken);
                    if (account is null)
                    {
                        logger.LogDebug("Meet calendar sync idle: no connected Google account.");
                    }
                    else if (account.Status != "connected")
                    {
                        logger.LogWarning(
                            "Meet calendar sync paused for {Email}: status is {Status}. Reconnect Google to resume.",
                            account.AccountEmail,
                            account.Status);
                    }
                    else
                    {
                        var sync = provider.GetRequiredService<CalendarSyncService>();
                        var result = await sync.SyncAsync(account, forceFull: false, stoppingToken);
                        if (result.Ok)
                        {
                            delay = TimeSpan.FromSeconds(Math.Clamp(options.SyncIntervalSeconds, 15, 600));
                        }
                        else
                        {
                            delay = Backoff(account.ConsecutiveFailures + 1);
                            logger.LogWarning(
                                "Meet calendar sync failed for {Email}: {Message}. Next attempt in {Delay}.",
                                account.AccountEmail,
                                result.Message,
                                delay);
                        }
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Meet calendar sync worker iteration failed.");
                delay = FailureDelay;
            }

            try
            {
                await Task.Delay(delay, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private static TimeSpan Backoff(int failures)
    {
        var exponent = Math.Clamp(failures, 1, 10);
        var seconds = Math.Min(Math.Pow(2, exponent) * 30, MaxBackoff.TotalSeconds);
        return TimeSpan.FromSeconds(seconds);
    }
}
