using System.Net.Mail;
using System.Security.Claims;
using Dar.Common.Domain;
using Dar.Modules.Identity.Abstractions;

namespace Dar.Modules.Identity.Features.SetUserEmail;

public sealed record SetUserEmailRequest(string Email);

public sealed class SetUserEmailHandler(IIdentityRepository repository)
{
    public async Task HandleAsync(
        Guid userId,
        SetUserEmailRequest request,
        Guid actorId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Email) ||
            !MailAddress.TryCreate(request.Email.Trim(), out var address))
        {
            throw AppException.Validation("email", "اكتب بريدًا إلكترونيًا صحيحًا.");
        }

        var email = address.Address.Trim().ToLowerInvariant();
        if (await repository.EmailExistsAsync(email, userId, cancellationToken))
            throw AppException.Conflict("هذا البريد مستخدم لحساب آخر.");

        var updated = await repository.UpdateEmailAsync(userId, email, actorId, cancellationToken);
        if (!updated) throw AppException.NotFound("الحساب غير موجود.");
    }
}

public static class SetUserEmailEndpoint
{
    public static IEndpointRouteBuilder MapSetUserEmail(this IEndpointRouteBuilder app)
    {
        app.MapPut("/api/v1/users/{id:guid}/email", async (
                Guid id,
                SetUserEmailRequest request,
                SetUserEmailHandler handler,
                ClaimsPrincipal principal,
                CancellationToken cancellationToken) =>
            {
                var actorId = Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var parsed)
                    ? parsed
                    : Guid.Empty;
                if (actorId == Guid.Empty) throw AppException.Unauthorized();

                await handler.HandleAsync(id, request, actorId, cancellationToken);
                return Results.Ok(new { id, email = request.Email.Trim().ToLowerInvariant() });
            })
            .RequireAuthorization("users.manage")
            .WithName("SetUserEmail")
            .WithTags("identity");

        return app;
    }
}
