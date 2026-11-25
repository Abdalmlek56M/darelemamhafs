using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Dar.Common.Domain;

namespace Dar.Api.Infrastructure.Errors;

/// <summary>
/// Last-resort handler for unexpected failures. Full details stay in the server log;
/// callers receive a generic Arabic ProblemDetails only.
/// </summary>
public sealed class UnexpectedExceptionHandler(ILogger<UnexpectedExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        // AppException is owned by AppExceptionHandler and keeps its exact 400/401/403/404/409/422/429 shape.
        if (exception is AppException)
            return false;

        // Never swallow client disconnects/cancellations.
        if (exception is OperationCanceledException)
            return false;

        logger.LogError(exception, "Unhandled exception on {Method} {Path}", httpContext.Request.Method, httpContext.Request.Path);

        if (httpContext.Response.HasStarted)
            return false;

        httpContext.Response.StatusCode = StatusCodes.Status500InternalServerError;
        httpContext.Response.ContentType = "application/problem+json; charset=utf-8";
        await httpContext.Response.WriteAsJsonAsync(new ProblemDetails
        {
            Status = StatusCodes.Status500InternalServerError,
            Title = "خطأ في الخادم",
            Detail = "حدث خطأ مؤقت في الخادم. لم يتم حفظ التغييرات، حاول بعد قليل.",
            Instance = httpContext.Request.Path
        }, cancellationToken);
        return true;
    }
}
