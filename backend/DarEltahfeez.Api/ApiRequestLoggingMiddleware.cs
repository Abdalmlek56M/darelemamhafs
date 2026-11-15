using System.Diagnostics;
using Microsoft.AspNetCore.Routing;

namespace DarEltahfeez.Api;

/// <summary>Records API request outcomes and timing without capturing bodies, cookies, or query strings.</summary>
public sealed class ApiRequestLoggingMiddleware(RequestDelegate next, ILogger<ApiRequestLoggingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if (!context.Request.Path.StartsWithSegments("/api") ||
            string.Equals(context.Request.Path.Value, "/api/health", StringComparison.OrdinalIgnoreCase))
        {
            await next(context);
            return;
        }

        var started = Stopwatch.GetTimestamp();
        Exception? failure = null;
        try
        {
            await next(context);
        }
        catch (Exception ex)
        {
            failure = ex;
            throw;
        }
        finally
        {
            var elapsedMs = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
            var route = (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText
                ?? context.Request.Path.Value
                ?? "/api";
            var status = failure is null ? context.Response.StatusCode : StatusCodes.Status500InternalServerError;
            var method = context.Request.Method;
            var traceId = context.TraceIdentifier;

            if (failure is not null)
                logger.LogError(failure, "HTTP {Method} {Route} failed with {StatusCode} in {ElapsedMs:F1} ms. TraceId={TraceId}", method, route, status, elapsedMs, traceId);
            else if (status >= 500)
                logger.LogError("HTTP {Method} {Route} returned {StatusCode} in {ElapsedMs:F1} ms. TraceId={TraceId}", method, route, status, elapsedMs, traceId);
            else if (status >= 400)
                logger.LogWarning("HTTP {Method} {Route} returned {StatusCode} in {ElapsedMs:F1} ms. TraceId={TraceId}", method, route, status, elapsedMs, traceId);
            else
                logger.LogInformation("HTTP {Method} {Route} returned {StatusCode} in {ElapsedMs:F1} ms. TraceId={TraceId}", method, route, status, elapsedMs, traceId);
        }
    }
}
