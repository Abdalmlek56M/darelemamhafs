using Dar.Common.Domain;
using Dar.Modules.Identity.Abstractions;
using Dar.Modules.Identity.Infrastructure;

namespace Dar.Modules.Identity.Features.PasswordSignIn;

public sealed record PasswordSignInRequest(string Username, string Password, bool RememberMe = false);

/// <summary>
/// Temporary migration fallback for accounts that do not have an email yet.
/// Remove this endpoint after every active user is on OTP/Google.
/// </summary>
public sealed class PasswordSignInHandler(IIdentityRepository repository)
{
    // Verified for unknown usernames so the response time does not reveal whether the account exists.
    private static readonly string DummyPasswordHash = PasswordHasher.Hash("p11-dummy-password-not-a-real-account");

    public async Task<UserSessionResponse> HandleAsync(
        PasswordSignInRequest request,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrEmpty(request.Password))
            throw AppException.Validation("credentials", "اكتب اسم المستخدم وكلمة المرور.");

        var normalizedUsername = request.Username.Trim().ToLowerInvariant();
        var user = await repository.FindByUsernameForLoginAsync(request.Username.Trim(), cancellationToken);
        var now = DateTimeOffset.UtcNow;

        // P1-1: the same lock table is consulted for every submitted username before any
        // account-specific branch, so existing and unknown usernames behave identically.
        if (await repository.GetLoginLockedUntilAsync(normalizedUsername, cancellationToken) is { } lockedUntil && lockedUntil > now)
        {
            var retryAfter = (int)Math.Ceiling((lockedUntil - now).TotalSeconds);
            throw AppException.TooManyRequests(LoginLockoutPolicy.LockedMessage(retryAfter), retryAfter);
        }

        // Manual admin lock remains a generic 401 and is not managed by the progressive table.
        if (user is { IsLocked: true })
            throw AppException.Unauthorized("بيانات الدخول غير صحيحة.");

        var passwordOk = user is not null && user.HasPassword
            ? PasswordHasher.Verify(request.Password, user.PasswordHash)
            : PasswordHasher.Verify(request.Password, DummyPasswordHash);
        if (!passwordOk)
        {
            var (_, lockedAfterFailure) = await repository.RegisterLoginFailureAsync(normalizedUsername, cancellationToken);
            try { await repository.CleanupLoginAttemptsAsync(cancellationToken); } catch { /* cleanup must not break sign-in */ }
            if (lockedAfterFailure is { } lockUntil && lockUntil > DateTimeOffset.UtcNow)
            {
                var retryAfter = (int)Math.Ceiling((lockUntil - DateTimeOffset.UtcNow).TotalSeconds);
                throw AppException.TooManyRequests(LoginLockoutPolicy.LockedMessage(retryAfter), retryAfter);
            }
            throw AppException.Unauthorized("بيانات الدخول غير صحيحة.");
        }

        if (user is null) throw AppException.Unauthorized("بيانات الدخول غير صحيحة.");
        await repository.ClearLoginFailuresAsync(normalizedUsername, cancellationToken);
        await AuthSession.SignInAsync(httpContext, user, request.RememberMe, cancellationToken);
        return AuthSession.FromUser(user);
    }
}
