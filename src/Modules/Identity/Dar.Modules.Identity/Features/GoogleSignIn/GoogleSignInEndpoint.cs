using Microsoft.AspNetCore.RateLimiting;

namespace Dar.Modules.Identity.Features.GoogleSignIn;

public static class GoogleSignInEndpoint
{
    public static RouteGroupBuilder MapGoogleSignIn(this RouteGroupBuilder group)
    {
        group.MapPost("/google", async (
                GoogleSignInRequest request,
                GoogleSignInHandler handler,
                HttpContext httpContext,
                CancellationToken cancellationToken) =>
            {
                var session = await handler.HandleAsync(request, httpContext, cancellationToken);
                return Results.Ok(session);
            })
            .AllowAnonymous()
            .RequireRateLimiting("auth")
            .WithName("GoogleSignIn")
            .WithTags("identity");

        return group;
    }
}
