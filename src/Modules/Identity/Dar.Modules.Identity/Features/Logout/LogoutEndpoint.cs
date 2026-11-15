using Dar.Modules.Identity.Infrastructure;
using Microsoft.AspNetCore.Authentication;

namespace Dar.Modules.Identity.Features.Logout;

public static class LogoutEndpoint
{
    public static RouteGroupBuilder MapLogout(this RouteGroupBuilder group)
    {
        group.MapPost("/logout", async (HttpContext httpContext) =>
            {
                await httpContext.SignOutAsync(AuthSession.Scheme);
                return Results.Ok(new { success = true });
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .WithName("Logout")
            .WithTags("identity");

        return group;
    }
}
