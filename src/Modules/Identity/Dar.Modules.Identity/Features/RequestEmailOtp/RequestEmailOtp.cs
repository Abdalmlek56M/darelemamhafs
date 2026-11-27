using System.Globalization;
using System.Net.Mail;
using System.Security.Cryptography;
using Dar.Common.Domain;
using Dar.Modules.Identity.Abstractions;
using Dar.Modules.Identity.Infrastructure;

namespace Dar.Modules.Identity.Features.RequestEmailOtp;

public sealed record RequestEmailOtpRequest(string Email);

public sealed class RequestEmailOtpHandler(
    IIdentityRepository repository,
    EmailQueue emailQueue,
    OtpCodeHasher codeHasher,
    IConfiguration configuration,
    ILogger<RequestEmailOtpHandler> logger)
{
    public async Task HandleAsync(
        RequestEmailOtpRequest request,
        string? ipAddress,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Email) ||
            !MailAddress.TryCreate(request.Email.Trim(), out var address))
        {
            throw AppException.Validation("email", "اكتب بريدًا إلكترونيًا صحيحًا.");
        }

        var email = address.Address.Trim().ToLowerInvariant();
        var user = await repository.FindByEmailAsync(email, cancellationToken);

        // Always return the same shape to avoid account enumeration.
        if (user is null)
        {
            logger.LogInformation("OTP requested for an unknown email.");
            return;
        }

        // Per-email throttle: 1 request/minute and 5/hour. Return the same 202 shape
        // instead of revealing that the address is being throttled.
        if (await repository.IsOtpRequestThrottledAsync(email, cancellationToken))
        {
            logger.LogInformation("OTP request throttled for an existing email.");
            return;
        }

        var code = RandomNumberGenerator.GetInt32(100_000, 1_000_000)
            .ToString(CultureInfo.InvariantCulture);
        var expiryMinutes = configuration.GetValue("Auth:Otp:ExpiryMinutes", 5);
        var maxAttempts = configuration.GetValue("Auth:Otp:MaxAttempts", 5);

        await repository.CreateOtpAsync(
            email,
            codeHasher.Hash(email, code),
            DateTimeOffset.UtcNow.AddMinutes(expiryMinutes),
            maxAttempts,
            ipAddress,
            cancellationToken);

        // FINAL 1.15: deliver via the background queue, never inline on the request thread.
        emailQueue.Enqueue(email, code);
    }
}
