using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Dar.Modules.Identity.Features.ChangePassword;

public static class ChangePasswordEndpoint
{
    public static RouteGroupBuilder MapChangePassword(this RouteGroupBuilder group)
    {
        group.MapPost("/change-password", async (
                ChangePasswordRequest request,
                System.Security.Claims.ClaimsPrincipal principal,
                HttpContext httpContext,
                ChangePasswordHandler handler,
                CancellationToken cancellationToken) =>
            {
                await handler.HandleAsync(request, principal, httpContext, cancellationToken);
                return Results.Ok(new { success = true });
            })
            .RequireAuthorization("account.password.self")
            .RequireRateLimiting("auth")
            .Produces(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity)
            .WithName("ChangePassword")
            .WithTags("identity");

        return group;
    }
}
