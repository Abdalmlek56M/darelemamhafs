namespace DarEltahfeez.Api;

/// <summary>
/// P1-3: baseline security headers for the admin SPA page only (/management).
/// The CSP is deployed as Report-Only first so violations can be observed before enforcement.
/// The teacher portal (/teacher) is deliberately excluded: it needs camera/microphone policies,
/// and the API (/api) already has its own headers.
/// </summary>
public sealed class ManagementSecurityHeadersMiddleware(RequestDelegate next)
{
    public static readonly string ContentSecurityPolicyReportOnly = string.Join(' ',
        "default-src 'self';",
        "script-src 'self' https://challenges.cloudflare.com;",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;",
        "font-src 'self' https://fonts.gstatic.com data:;",
        "img-src 'self' data: blob:;",
        "media-src 'self' blob:;",
        "connect-src 'self' https://challenges.cloudflare.com;",
        "frame-src https://challenges.cloudflare.com;",
        "worker-src 'self';",
        "manifest-src 'self';",
        "object-src 'none';",
        "base-uri 'self';",
        "frame-ancestors 'none';",
        "form-action 'self';",
        "upgrade-insecure-requests;");

    public async Task InvokeAsync(HttpContext context)
    {
        if (context.Request.Path.StartsWithSegments("/management"))
        {
            var headers = context.Response.Headers;
            headers["X-Content-Type-Options"] = "nosniff";
            headers["X-Frame-Options"] = "DENY";
            headers["Referrer-Policy"] = "no-referrer";
            headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";
            // Report-Only on purpose for P1-3 phase 1; enforce in a later, separately approved step.
            headers["Content-Security-Policy-Report-Only"] = ContentSecurityPolicyReportOnly;
            if (context.Request.IsHttps)
                headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
        }

        await next(context);
    }
}
