namespace DarEltahfeez.Api;

/// <summary>
/// P0-13: one security-header policy for every SPA response (/, /teacher, /supervisor, /management
/// and static assets). The API has its own headers in Program.cs. The Report-Only CSP was removed
/// because the enforced policy already covers the same directives.
/// style-src keeps 'unsafe-inline': the React UI uses inline style attributes for layout, and a
/// nonce-based rollout would need a separate migration. Revisit when styles move to classes.
/// </summary>
public sealed class SpaSecurityHeadersMiddleware(RequestDelegate next)
{
    public static readonly string ContentSecurityPolicy = string.Join(' ',
        "default-src 'self';",
        "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com;",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;",
        "font-src 'self' https://fonts.gstatic.com data:;",
        "img-src 'self' data: blob:;",
        "media-src 'self' blob:;",
        "connect-src 'self' https://challenges.cloudflare.com https://cloudflareinsights.com;",
        "frame-src https://challenges.cloudflare.com;",
        "worker-src 'self';",
        "manifest-src 'self';",
        "object-src 'none';",
        "base-uri 'self';",
        "frame-ancestors 'none';",
        "form-action 'self';");

    private static readonly HashSet<string> SpaEntryPaths = new(StringComparer.OrdinalIgnoreCase)
    {
        "/",
        "/index.html",
        "/teacher",
        "/teacher/",
        "/supervisor",
        "/supervisor/",
        "/management",
        "/management/",
    };

    /// <summary>The only client routes that may receive the SPA shell; everything else is a real 404.</summary>
    public static bool IsSpaEntry(PathString path) => SpaEntryPaths.Contains(path.Value ?? string.Empty);

    public async Task InvokeAsync(HttpContext context)
    {
        if (!context.Request.Path.StartsWithSegments("/api"))
        {
            var headers = context.Response.Headers;
            headers["X-Content-Type-Options"] = "nosniff";
            headers["X-Frame-Options"] = "DENY";
            headers["Referrer-Policy"] = "no-referrer";
            headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";
            headers["Content-Security-Policy"] = ContentSecurityPolicy;
            if (context.Request.IsHttps)
                headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
        }

        await next(context);
    }
}
