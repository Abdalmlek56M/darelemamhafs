using System.Security.Claims;
using Dar.Modules.Identity.Infrastructure;

namespace Dar.Modules.Identity.Features.GetCurrentUser;

public static class GetCurrentUserEndpoint
{
    public static RouteGroupBuilder MapGetCurrentUser(this RouteGroupBuilder group)
    {
        group.MapGet("/me", (ClaimsPrincipal principal) =>
                Results.Ok(AuthSession.FromPrincipal(principal)))
            .RequireAuthorization()
            .WithName("GetCurrentUser")
            .WithTags("identity");

        return group;
    }
}
