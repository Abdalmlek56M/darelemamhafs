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

        var user = await repository.FindByUsernameAsync(request.Username.Trim(), cancellationToken);
        if (user is null || !user.HasPassword || !PasswordHasher.Verify(request.Password, user.PasswordHash))
            throw AppException.Unauthorized("بيانات الدخول غير صحيحة.");

        await AuthSession.SignInAsync(httpContext, user, request.RememberMe, cancellationToken);
        return AuthSession.FromUser(user);
    }
}
