namespace DarEltahfeez.Api.Media;

/// <summary>
/// Optional deliberate backfill at application startup, enabled only by
/// Media__BackfillOnStartup=true. It is registered by Program.cs only when that flag is set, runs
/// once after the host starts (never blocking health checks) and uses the same
/// <see cref="MediaBackfillService"/> as the admin endpoint. Failures are logged and do not crash
/// the API: the legacy BYTEA columns stay readable through the lazy migration path.
/// </summary>
public sealed class MediaBackfillWorker(
    MediaBackfillService backfillService,
    ILogger<MediaBackfillWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Yield so host startup (Kestrel, health checks) is not delayed by a large migration.
        await Task.Yield();
        try
        {
            var result = await backfillService.RunAsync(dryRun: false, stoppingToken);
            logger.LogInformation(
                "Media backfill (startup) receipts={Receipts} avatars={Avatars} logos={Logos} elapsed={ElapsedMs}ms",
                result.Receipts, result.Avatars, result.Logos, result.ElapsedMilliseconds);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Normal shutdown during the backfill; every already-migrated row is durable.
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Media backfill (startup) failed; legacy BYTEA rows remain readable via lazy migration.");
        }
    }
}
