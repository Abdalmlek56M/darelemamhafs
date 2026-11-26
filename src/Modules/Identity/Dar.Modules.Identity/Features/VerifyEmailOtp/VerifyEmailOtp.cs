using Dar.Common.Domain;
using Dar.Modules.Identity.Abstractions;
using Dar.Modules.Identity.Infrastructure;

namespace Dar.Modules.Identity.Features.VerifyEmailOtp;

public sealed record VerifyEmailOtpRequest(string Email, string Code, bool RememberMe = false);

public sealed class VerifyEmailOtpHandler(
    IIdentityRepository repository,
    OtpCodeHasher codeHasher)
{
    public async Task<UserSessionResponse> HandleAsync(
        VerifyEmailOtpRequest request,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Email) ||
            string.IsNullOrWhiteSpace(request.Code) ||
            request.Code.Length != 6 ||
            !request.Code.All(char.IsDigit))
        {
            throw AppException.Validation("code", "اكتب البريد والكود المكوّن من 6 أرقام.");
        }

        var email = request.Email.Trim().ToLowerInvariant();
        var otp = await repository.GetLatestOtpAsync(email, cancellationToken)
                  ?? throw AppException.Validation("code", "الكود غير صحيح أو منتهي.");

        if (otp.ConsumedAt is not null || otp.ExpiresAt <= DateTimeOffset.UtcNow)
            throw AppException.Validation("code", "الكود غير صحيح أو منتهي.");

        if (otp.Attempts >= otp.MaxAttempts)
            throw AppException.Conflict("تم تجاوز عدد المحاولات. اطلب كودًا جديدًا.");

        if (!codeHasher.Verify(email, request.Code, otp.CodeHash))
        {
            await repository.IncrementOtpAttemptsAsync(otp.Id, cancellationToken);
            throw AppException.Validation("code", "الكود غير صحيح أو منتهي.");
        }

        var user = await repository.FindByEmailAsync(email, cancellationToken)
                   ?? throw AppException.Unauthorized("الحساب غير متاح.");

        // FINAL 1.15: atomically consume the OTP; two concurrent verifications with the same
        // code must not both succeed.
        if (!await repository.TryConsumeOtpAsync(otp.Id, cancellationToken))
            throw AppException.Validation("code", "الكود غير صحيح أو منتهي.");
        await AuthSession.SignInAsync(httpContext, user, request.RememberMe, cancellationToken);

        return AuthSession.FromUser(user);
    }
}
