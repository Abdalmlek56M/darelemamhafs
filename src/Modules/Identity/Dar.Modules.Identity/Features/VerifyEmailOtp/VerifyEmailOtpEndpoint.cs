using Microsoft.AspNetCore.RateLimiting;

namespace Dar.Modules.Identity.Features.VerifyEmailOtp;

public static class VerifyEmailOtpEndpoint
{
    public static RouteGroupBuilder MapVerifyEmailOtp(this RouteGroupBuilder group)
    {
        group.MapPost("/email/verify", async (
                VerifyEmailOtpRequest request,
                VerifyEmailOtpHandler handler,
                HttpContext httpContext,
                CancellationToken cancellationToken) =>
            {
                var session = await handler.HandleAsync(request, httpContext, cancellationToken);
                return Results.Ok(session);
            })
            .AllowAnonymous()
            .RequireRateLimiting("auth")
            .WithName("VerifyEmailOtp")
            .WithTags("identity");

        return group;
    }
}
