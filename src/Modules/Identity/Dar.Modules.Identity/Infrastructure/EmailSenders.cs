using System.Net;
using System.Net.Mail;
using Dar.Modules.Identity.Abstractions;
using Microsoft.Extensions.Options;

namespace Dar.Modules.Identity.Infrastructure;

/// <summary>Development fallback: logs the OTP, never sends email.</summary>
public sealed class LoggingEmailSender(
    ILogger<LoggingEmailSender> logger,
    IHostEnvironment environment) : IEmailSender
{
    public Task SendLoginCodeAsync(string email, string code, CancellationToken ct)
    {
        if (!environment.IsDevelopment())
            throw new InvalidOperationException("SMTP is not configured; OTP email cannot be sent in this environment.");

        logger.LogWarning("DEV OTP for {Email}: {Code}", email, code);
        return Task.CompletedTask;
    }
}

/// <summary>Minimal SMTP sender for OTP emails. Replace with a transactional provider later.</summary>
public sealed class SmtpEmailSender(IOptions<SmtpOptions> options) : IEmailSender
{
    public async Task SendLoginCodeAsync(string email, string code, CancellationToken ct)
    {
        var smtp = options.Value;
        if (string.IsNullOrWhiteSpace(smtp.Host) || string.IsNullOrWhiteSpace(smtp.From))
            throw new InvalidOperationException("SMTP is not configured.");

        using var message = new MailMessage(smtp.From, email)
        {
            Subject = "كود الدخول — دار الإمام حفص",
            Body = $"كود الدخول الخاص بك هو: {code}\nصالح لمدة 5 دقائق. لا تشاركه مع أي شخص.",
            IsBodyHtml = false
        };

        using var client = new SmtpClient(smtp.Host, smtp.Port)
        {
            EnableSsl = smtp.EnableSsl,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            UseDefaultCredentials = false
        };

        if (!string.IsNullOrWhiteSpace(smtp.User))
            client.Credentials = new NetworkCredential(smtp.User, smtp.Password);

        await client.SendMailAsync(message, ct);
    }
}
