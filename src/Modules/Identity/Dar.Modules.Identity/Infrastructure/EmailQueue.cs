using System.Threading.Channels;
using Dar.Modules.Identity.Abstractions;

namespace Dar.Modules.Identity.Infrastructure;

/// <summary>
/// FINAL 1.15: SMTP is no longer sent inline on the request thread. The OTP request
/// completes after the code is stored, and a background worker delivers it with retries.
/// The in-memory queue is bounded; a restart loses undelivered codes, but the user can
/// simply request a new code.
/// </summary>
public sealed class EmailQueue(IServiceProvider provider, ILogger<EmailQueue> logger) : BackgroundService
{
    public sealed record QueuedEmail(string Email, string Code);

    private readonly Channel<QueuedEmail> channel = Channel.CreateBounded<QueuedEmail>(new BoundedChannelOptions(1000)
    {
        FullMode = BoundedChannelFullMode.DropOldest
    });

    public bool Enqueue(string email, string code)
    {
        if (channel.Writer.TryWrite(new QueuedEmail(email, code))) return true;
        logger.LogWarning("OTP email queue is full; the code was stored but email delivery was skipped");
        return false;
    }

    /// <summary>Delivers one queued email; exported for unit tests and for operational drain.</summary>
    public async Task<bool> ProcessOnceAsync(IEmailSender sender, CancellationToken ct)
    {
        if (!channel.Reader.TryRead(out var item)) return false;
        try
        {
            await sender.SendLoginCodeAsync(item.Email, item.Code, ct);
            return true;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "OTP email delivery failed for {Email}", item.Email);
            return false;
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var delivered = false;
            try
            {
                using var scope = provider.CreateScope();
                var sender = scope.ServiceProvider.GetRequiredService<IEmailSender>();
                delivered = await ProcessOnceAsync(sender, stoppingToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogWarning(exception, "OTP email worker iteration failed");
            }

            if (!delivered)
            {
                try { await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
        }
    }
}
