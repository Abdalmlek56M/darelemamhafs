using Dar.Common.Domain;
using Dar.Modules.Identity.Abstractions;
using Dar.Modules.Identity.Infrastructure;
using Google.Apis.Auth;

namespace Dar.Modules.Identity.Features.GoogleSignIn;

public sealed record GoogleSignInRequest(string IdToken);

public sealed class GoogleSignInHandler(
    IIdentityRepository repository,
    IConfiguration configuration,
    ILogger<GoogleSignInHandler> logger)
{
    public async Task<UserSessionResponse> HandleAsync(
        GoogleSignInRequest request,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var clientId = configuration["Auth:Google:ClientId"];
        if (string.IsNullOrWhiteSpace(clientId))
            throw new AppException("تسجيل الدخول بـ Google غير مهيأ.", 503);
        if (string.IsNullOrWhiteSpace(request.IdToken))
            throw AppException.Validation("idToken", "رمز Google مطلوب.");

        GoogleJsonWebSignature.Payload payload;
        try
        {
            payload = await GoogleJsonWebSignature.ValidateAsync(
                request.IdToken,
                new GoogleJsonWebSignature.ValidationSettings { Audience = [clientId] });
        }
        catch (InvalidJwtException exception)
        {
            logger.LogWarning(exception, "Invalid Google ID token.");
            throw AppException.Unauthorized("رمز Google غير صالح.");
        }

        if (!payload.EmailVerified || string.IsNullOrWhiteSpace(payload.Email))
            throw AppException.Unauthorized("بريد Google غير موثّق.");

        var email = payload.Email.Trim().ToLowerInvariant();
        var user = await repository.FindByGoogleSubjectAsync(payload.Subject, cancellationToken)
                   ?? await repository.FindByEmailAsync(email, cancellationToken);

        if (user is null)
            throw AppException.Unauthorized("هذا البريد غير مسجل في الدار. اطلب من المدير إنشاء الحساب أولًا.");

        if (user.Email is not null &&
            !string.Equals(user.Email, email, StringComparison.OrdinalIgnoreCase))
        {
            throw AppException.Unauthorized("بريد Google لا يطابق بريد الحساب.");
        }

        await repository.LinkGoogleSubjectAsync(user.Id, payload.Subject, user.Id, cancellationToken);
        await AuthSession.SignInAsync(httpContext, user, persistent: true, cancellationToken);

        return AuthSession.FromUser(user);
    }
}
