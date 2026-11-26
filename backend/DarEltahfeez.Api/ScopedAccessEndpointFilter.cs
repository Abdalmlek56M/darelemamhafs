using Npgsql;
using Dar.Common.Permissions;
using DarEltahfeez.Api.Scoping;

namespace DarEltahfeez.Api;

/// <summary>
/// Applies shared scope rules to legacy endpoints. Unscoped users and users.manage
/// keep current access; scoped users are denied outside their scope and for unlinked
/// targets that cannot be resolved (fail closed).
/// </summary>
public sealed class ScopedAccessEndpointFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (http.User.Identity?.IsAuthenticated != true) return await next(context);
        var dataSource = http.RequestServices.GetRequiredService<NpgsqlDataSource>();
        await using var connection = await dataSource.OpenConnectionAsync(http.RequestAborted);
        var scope = await ScopeLoader.LoadAsync(connection, http.User, http.RequestAborted);
        if (scope.All) return await next(context);

        var target = await ScopeTargetResolution.ResolveAsync(connection, context);
        // FINAL 0.6: unresolved targets fail closed. A scoped user never reaches a filtered
        // endpoint whose resource cannot be resolved into their circle/teacher scope.
        if (target is null)
            return Results.Json(new { message = "هذا السجل خارج نطاقك." }, statusCode: StatusCodes.Status403Forbidden);
        if (ScopedEntityRules.Allows(scope, target.Value)) return await next(context);
        return Results.Json(new { message = "هذا السجل خارج نطاقك." }, statusCode: StatusCodes.Status403Forbidden);
    }
}
