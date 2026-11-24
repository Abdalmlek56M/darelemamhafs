using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Dar.Common.Domain;

namespace Dar.Api.Infrastructure.Errors;

/// <summary>
/// Maps expected business failures to one RFC 9457 ProblemDetails shape.
/// Endpoints and handlers should throw AppException, not build error responses.
/// </summary>
public sealed class AppExceptionHandler(ILogger<AppExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        if (exception is not AppException appException)
            return false;

        logger.LogInformation(
            "Business exception {Status} on {Path}: {Message}",
            appException.StatusCode,
            httpContext.Request.Path,
            appException.Message);

        var problem = new ProblemDetails
        {
            Status = appException.StatusCode,
            Title = appException.StatusCode switch
            {
                401 => "غير مصرح",
                403 => "ممنوع",
                404 => "غير موجود",
                409 => "تعارض",
                422 => "بيانات غير صالحة",
                429 => "محاولات كثيرة",
                _ => "طلب غير صالح"
            },
            Detail = appException.Message,
            Instance = httpContext.Request.Path
        };

        if (appException.Errors is { Count: > 0 })
            problem.Extensions["errors"] = appException.Errors;

        httpContext.Response.StatusCode = appException.StatusCode;
        if (appException.RetryAfterSeconds is { } retryAfterSeconds)
            httpContext.Response.Headers.RetryAfter = retryAfterSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
        await httpContext.Response.WriteAsJsonAsync(problem, cancellationToken);
        return true;
    }
}
