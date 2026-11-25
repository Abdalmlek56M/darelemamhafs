using System.Text.Json;
using System.Text.Json.Nodes;
using Npgsql;
using Dar.Common.Permissions;

namespace DarEltahfeez.Api;

/// <summary>Filters legacy list responses to the caller's circle/teacher scope.</summary>
public sealed class ScopedListEndpointFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        if (http.User.Identity?.IsAuthenticated != true) return await next(context);
        var dataSource = http.RequestServices.GetRequiredService<NpgsqlDataSource>();
        await using var connection = await dataSource.OpenConnectionAsync(http.RequestAborted);
        var scope = await ScopeLoader.LoadAsync(connection, http.User, http.RequestAborted);
        var result = await next(context);
        if (scope.All) return result;
        if (result is not IValueHttpResult { Value: not null } value) return result;
        var node = JsonSerializer.SerializeToNode(value.Value);
        FilterNode(node, scope);
        return Results.Json(node);
    }

    private static void FilterNode(JsonNode? node, AccessScope scope)
    {
        if (node is JsonArray root)
        {
            for (var i = root.Count - 1; i >= 0; i--)
                if (root[i] is JsonObject item && ScopeId(item) is { } target && !scope.AllowsTarget(target.CircleId, target.TeacherId)) root.RemoveAt(i);
            return;
        }
        if (node is not JsonObject obj) return;
        foreach (var property in obj.ToList())
        {
            if (property.Value is JsonArray array)
            {
                for (var i = array.Count - 1; i >= 0; i--)
                {
                    if (array[i] is JsonObject item && ScopeId(item) is { } target && !scope.AllowsTarget(target.CircleId, target.TeacherId)) array.RemoveAt(i);
                }
                if (obj["count"] is not null) obj["count"] = array.Count;
                continue;
            }
            FilterNode(property.Value, scope);
        }
    }

    private static (Guid? CircleId, Guid? TeacherId)? ScopeId(JsonObject item)
    {
        Guid? circle = Guid.TryParse(item["circleId"]?.ToString(), out var c) ? c : null;
        Guid? teacher = Guid.TryParse(item["teacherId"]?.ToString(), out var t) ? t : null;
        return circle is null && teacher is null ? null : (circle, teacher);
    }
}
