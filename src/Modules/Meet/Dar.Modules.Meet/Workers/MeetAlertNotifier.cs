using System.Net.Http.Json;
using Dar.Modules.Meet.Infrastructure;
using Dar.Modules.Meet.Persistence;

namespace Dar.Modules.Meet.Workers;

/// <summary>
/// Delivers pending alerts to the owner's channels. Telegram is the default because it
/// needs no SMTP setup; delivery is marked on the row so a restart never duplicates it.
/// </summary>
public sealed class MeetAlertNotifier(
    IServiceScopeFactory scopeFactory,
    IHttpClientFactory httpClientFactory,
    ILogger<MeetAlertNotifier> logger) : BackgroundService
{
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(40);
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(45);
    private const int BatchSize = 10;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { await Task.Delay(StartupDelay, stoppingToken); }
        catch (OperationCanceledException) { return; }

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
                    var settings = await provider.GetRequiredService<MeetScopeRepository>().GetSettingsAsync(stoppingToken);
                    var chatId = settings?.TelegramChatId;
                    var storedToken = settings?.TelegramBotToken;
                    var token = storedToken;
                    if (!string.IsNullOrWhiteSpace(storedToken))
                    {
                        // FINAL 0.5: stored tokens are AES-GCM encrypted; legacy plaintext still works
                        // until the next settings save re-encrypts it.
                        token = crypto.TryDecrypt(storedToken, out var plaintext) ? plaintext : storedToken;
                    }
                    if (!string.IsNullOrWhiteSpace(chatId) && !string.IsNullOrWhiteSpace(token))
                    {
                        var repository = provider.GetRequiredService<MeetAlertRepository>();
                        var pending = await repository.ListPendingAsync(BatchSize, stoppingToken);
                        foreach (var alert in pending)
                        {
                            var delivered = await SendAsync(token!, chatId!, alert, stoppingToken);
                            await repository.MarkDeliveryAsync(alert.Id, delivered, delivered ? null : "telegram failed", stoppingToken);
                            if (delivered)
                                logger.LogInformation("Meet alert {Code} delivered to Telegram", alert.Code);
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
                logger.LogWarning(exception, "Meet alert delivery iteration failed.");
            }

            try { await Task.Delay(Interval, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>FINAL 1.10: alert text is HTML mode; escape user/DB values so a title or body cannot inject tags.</summary>
    public static string EscapeTelegramHtml(string? value) =>
        (value ?? string.Empty).Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");

    private async Task<bool> SendAsync(string token, string chatId, MeetAlertRow alert, CancellationToken ct)
    {
        const string severity = "warning";
        var text = $"{(severity == "warning" ? "⚠️" : "ℹ️")} <b>{EscapeTelegramHtml(alert.Title)}</b>\n{EscapeTelegramHtml(alert.Body)}\n<i>{EscapeTelegramHtml(alert.Code)}</i>";
        try
        {
            var client = httpClientFactory.CreateClient("meet-telegram");
            var response = await client.PostAsJsonAsync(
                $"https://api.telegram.org/bot{token}/sendMessage",
                new { chat_id = chatId, text, parse_mode = "HTML", disable_web_page_preview = true },
                ct);
            if (response.IsSuccessStatusCode) return true;
            logger.LogWarning("Telegram rejected an alert: {Status}", (int)response.StatusCode);
            return false;
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Telegram request failed");
            return false;
        }
    }
}
