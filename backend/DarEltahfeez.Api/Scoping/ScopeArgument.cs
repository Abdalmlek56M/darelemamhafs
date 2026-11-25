using Dar.Common.Permissions;

namespace DarEltahfeez.Api.Scoping;

internal static class ScopeArgument
{
    public static object? Find(EndpointFilterInvocationContext context, string typeName) =>
        context.Arguments.FirstOrDefault(arg => arg?.GetType().Name == typeName);

    public static Guid? GuidProperty(object? value, string property)
    {
        if (value is null) return null;
        var raw = value.GetType().GetProperty(property)?.GetValue(value);
        return raw is Guid id && id != Guid.Empty ? id : null;
    }

    public static Guid? GuidProperty(EndpointFilterInvocationContext context, string typeName, string property) =>
        GuidProperty(Find(context, typeName), property);

    public static IResult Denied() => Results.Json(new { message = "هذا السجل خارج نطاقك." }, statusCode: StatusCodes.Status403Forbidden);
}
