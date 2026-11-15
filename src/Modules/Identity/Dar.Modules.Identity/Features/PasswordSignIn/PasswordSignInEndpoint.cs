using Microsoft.AspNetCore.RateLimiting;

namespace Dar.Modules.Identity.Features.PasswordSignIn;

public static class PasswordSignInEndpoint
{
    public static RouteGroupBuilder MapPasswordSignIn(this RouteGroupBuilder group)
    {
        group.MapPost("/password", async (
                PasswordSignInRequest request,
                PasswordSignInHandler handler,
                HttpContext httpContext,
                CancellationToken cancellationToken) =>
            {
                var session = await handler.HandleAsync(request, httpContext, cancellationToken);
                return Results.Ok(session);
            })
            .AllowAnonymous()
            .RequireRateLimiting("auth")
            .WithName("PasswordSignIn")
            .WithTags("identity");

        return group;
    }
}
