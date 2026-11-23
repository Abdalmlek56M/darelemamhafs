using Dar.Modules.Meet.Application;
using Dar.Modules.Meet.Infrastructure;
using Dar.Modules.Meet.Persistence;

namespace Dar.Modules.Meet.Workers;

/// <summary>
/// Turns calendar occurrences into queued recording jobs (ADR-0007 §3.3).
/// Runs every 15s: creates jobs for eligible events inside the horizon and cancels jobs
/// whose event Google cancelled. The bot itself only claims, so this stays cheap.
/// </summary>
public sealed class MeetSchedulerWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<MeetSchedulerWorker> logger) : BackgroundService
{
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(25);
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(15);
    private const int HorizonMinutes = 10;

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
            try
            {
                using var scope = scopeFactory.CreateScope();
                var provider = scope.ServiceProvider;
                var options = provider.GetRequiredService<IOptions<MeetOptions>>().Value;
                var crypto = provider.GetRequiredService<MeetCrypto>();

                if (options.IsConfigured && crypto.IsReady)
                {
                    var repository = provider.GetRequiredService<MeetBotJobRepository>();
                    var reaped = await repository.ReapStalledAsync(150, stoppingToken);
                    if (reaped > 0)
                    {
                        logger.LogWarning("Meet scheduler: closed {Count} stalled recording sessions", reaped);
                        await provider.GetRequiredService<MeetAlertRepository>().CreateAsync(
                            "critical",
                            "bot_stalled",
                            "توقف البوت أثناء التسجيل",
                            "أُغلقت جلسة تسجيل بسبب انقطاع البوت. راجع الخدمة والسجلات.",
                            null,
                            null,
                            stoppingToken);
                    }

                    var created = await repository.ScheduleDueAsync(HorizonMinutes, stoppingToken);
                    var cancelled = await repository.CancelOrphanedAsync(stoppingToken);
                    if (created > 0 || cancelled > 0)
                    {
                        logger.LogInformation(
                            "Meet scheduler: created={Created} cancelled={Cancelled}", created, cancelled);
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Meet scheduler iteration failed.");
            }

            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }
}
