using Dar.Modules.Identity.Infrastructure;
using Microsoft.AspNetCore.RateLimiting;

namespace Dar.Modules.Identity.Features.PasswordSignIn;

/// <summary>Public configuration for the login page (site key is public; the secret never leaves the server).</summary>
public static class TurnstileConfigEndpoint
{
    public static RouteGroupBuilder MapTurnstileConfig(this RouteGroupBuilder group)
    {
        group.MapGet("/config", (TurnstileVerifier verifier) =>
                Results.Ok(new
                {
                    enabled = verifier.Enabled,
                    siteKey = verifier.Enabled ? verifier.SiteKey : null
                }))
            .AllowAnonymous()
            .WithName("AuthConfig")
            .WithTags("identity");
        return group;
    }
}
