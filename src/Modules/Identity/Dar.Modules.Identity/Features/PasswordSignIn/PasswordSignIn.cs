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
    public async Task<UserSessionResponse> HandleAsync(
        PasswordSignInRequest request,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrEmpty(request.Password))
            throw AppException.Validation("credentials", "اكتب اسم المستخدم وكلمة المرور.");

        // P1-1: look the account up even when it is locked so manual and progressive locks are
        // distinguishable. Unknown usernames keep the same generic 401 (no enumeration).
        var user = await repository.FindByUsernameForLoginAsync(request.Username.Trim(), cancellationToken);
        if (user is null) throw AppException.Unauthorized("بيانات الدخول غير صحيحة.");
        if (user.IsLocked) throw AppException.Unauthorized("بيانات الدخول غير صحيحة.");

        var now = DateTimeOffset.UtcNow;
        if (user.LoginLockedUntil is { } lockedUntil && lockedUntil > now)
        {
            var retryAfter = (int)Math.Ceiling((lockedUntil - now).TotalSeconds);
            throw AppException.TooManyRequests(LoginLockoutPolicy.LockedMessage(retryAfter), retryAfter);
        }

        if (!user.HasPassword || !PasswordHasher.Verify(request.Password, user.PasswordHash))
        {
            var (_, lockedAfterFailure) = await repository.RegisterLoginFailureAsync(user.Id, cancellationToken);
            if (lockedAfterFailure is { } lockUntil && lockUntil > now)
            {
                var retryAfter = (int)Math.Ceiling((lockUntil - now).TotalSeconds);
                throw AppException.TooManyRequests(LoginLockoutPolicy.LockedMessage(retryAfter), retryAfter);
            }
            throw AppException.Unauthorized("بيانات الدخول غير صحيحة.");
        }

        await repository.ClearLoginFailuresAsync(user.Id, cancellationToken);
        await AuthSession.SignInAsync(httpContext, user, request.RememberMe, cancellationToken);
        return AuthSession.FromUser(user);
    }
}
