using Microsoft.AspNetCore.RateLimiting;

namespace Dar.Modules.Identity.Features.RequestEmailOtp;

public static class RequestEmailOtpEndpoint
{
    public static RouteGroupBuilder MapRequestEmailOtp(this RouteGroupBuilder group)
    {
        group.MapPost("/email/request", async (
                RequestEmailOtpRequest request,
                RequestEmailOtpHandler handler,
                HttpContext httpContext,
                CancellationToken cancellationToken) =>
            {
                await handler.HandleAsync(
                    request,
                    httpContext.Connection.RemoteIpAddress?.ToString(),
                    cancellationToken);

                // Generic response: never reveal whether the email exists.
                return Results.Accepted();
            })
            .AllowAnonymous()
            .RequireRateLimiting("auth")
            .Produces(StatusCodes.Status202Accepted)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity)
            .WithName("RequestEmailOtp")
            .WithTags("identity");

        return group;
    }
}
