using System.Security.Claims;
using Dar.Common.Domain;
using Dar.Modules.Identity.Abstractions;
using Dar.Modules.Identity.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;

namespace Dar.Modules.Identity.Features.ChangePassword;

public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public sealed class ChangePasswordHandler(IIdentityRepository repository)
{
    public async Task HandleAsync(
        ChangePasswordRequest request,
        ClaimsPrincipal principal,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var idValue = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(idValue, out var userId))
            throw AppException.Unauthorized("انتهت الجلسة. سجّل الدخول مرة أخرى.");

        if (string.IsNullOrEmpty(request.CurrentPassword))
            throw AppException.Validation("currentPassword", "اكتب كلمة المرور الحالية.");

        if (string.IsNullOrEmpty(request.NewPassword) || request.NewPassword.Length is < 6 or > 200)
            throw AppException.Validation("newPassword", "كلمة المرور الجديدة يجب أن تكون بين 6 و200 حرف.");

        var user = await repository.FindByIdAsync(userId, cancellationToken);
        if (user is null || !user.HasPassword || !PasswordHasher.Verify(request.CurrentPassword, user.PasswordHash))
            throw AppException.Validation("currentPassword", "كلمة المرور الحالية غير صحيحة.");

        if (PasswordHasher.Verify(request.NewPassword, user.PasswordHash))
            throw AppException.Validation("newPassword", "كلمة المرور الجديدة يجب أن تختلف عن الحالية.");

        await repository.UpdatePasswordAsync(userId, PasswordHasher.Hash(request.NewPassword), cancellationToken);
        await httpContext.SignOutAsync(AuthSession.Scheme);
    }
}
