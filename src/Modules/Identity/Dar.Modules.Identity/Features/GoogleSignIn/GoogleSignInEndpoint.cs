using Dar.Modules.Identity.Infrastructure;
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
            .Produces<UserSessionResponse>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable)
            .WithName("GoogleSignIn")
            .WithTags("identity");

        return group;
    }
}
