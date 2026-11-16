namespace DarEltahfeez.Api;

/// <summary>
/// Baseline CSRF defense for browser requests: unsafe API calls must come from the
/// same origin. Non-browser clients that send neither Origin nor Referer are allowed
/// through because they are not cookie-driven cross-site requests.
/// </summary>
public sealed class SameOriginGuardMiddleware(RequestDelegate next, ILogger<SameOriginGuardMiddleware> logger)
{
    private static readonly HashSet<string> UnsafeMethods = new(StringComparer.OrdinalIgnoreCase)
    {
        HttpMethods.Post,
        HttpMethods.Put,
        HttpMethods.Patch,
        HttpMethods.Delete
    };

    public async Task InvokeAsync(HttpContext context)
    {
        if (!context.Request.Path.StartsWithSegments("/api") ||
            !UnsafeMethods.Contains(context.Request.Method))
        {
            await next(context);
            return;
        }

        var origin = context.Request.Headers.Origin.ToString();
        if (string.IsNullOrWhiteSpace(origin))
        {
            var referer = context.Request.Headers.Referer.ToString();
            if (!string.IsNullOrWhiteSpace(referer) &&
                Uri.TryCreate(referer, UriKind.Absolute, out var refererUri))
            {
                origin = $"{refererUri.Scheme}://{refererUri.Authority}";
            }
        }

        if (string.IsNullOrWhiteSpace(origin))
        {
            await next(context);
            return;
        }

        var expected = $"{context.Request.Scheme}://{context.Request.Host}";
        if (string.Equals(origin.TrimEnd('/'), expected.TrimEnd('/'), StringComparison.OrdinalIgnoreCase))
        {
            await next(context);
            return;
        }

        logger.LogWarning(
            "Rejected cross-origin {Method} {Path} from {Origin}",
            context.Request.Method,
            context.Request.Path,
            origin);
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new { message = "طلب غير مسموح من أصل مختلف." });
    }
}
