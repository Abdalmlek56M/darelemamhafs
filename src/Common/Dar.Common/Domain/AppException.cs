namespace Dar.Common.Domain;

/// <summary>
/// Expected business failure. The API maps this once to RFC 9457 ProblemDetails.
/// Domain and handlers throw this instead of returning HTTP-specific results.
/// </summary>
public class AppException : Exception
{
    public int StatusCode { get; }
    public IReadOnlyDictionary<string, string[]>? Errors { get; }

    public AppException(
        string message,
        int statusCode = StatusCodes.BadRequest,
        IReadOnlyDictionary<string, string[]>? errors = null)
        : base(message)
    {
        StatusCode = statusCode;
        Errors = errors;
    }

    public static AppException Validation(string field, string message) =>
        new(message, StatusCodes.UnprocessableEntity,
            new Dictionary<string, string[]> { [field] = [message] });

    public static AppException NotFound(string message = "السجل غير موجود.") =>
        new(message, StatusCodes.NotFound);

    public static AppException Conflict(string message) =>
        new(message, StatusCodes.Conflict);

    public static AppException Forbidden(string message = "لا تملك الصلاحية المطلوبة.") =>
        new(message, StatusCodes.Forbidden);

    public static AppException Unauthorized(string message = "الجلسة منتهية أو غير صالحة.") =>
        new(message, StatusCodes.Unauthorized);
}

internal static class StatusCodes
{
    public const int BadRequest = 400;
    public const int Unauthorized = 401;
    public const int Forbidden = 403;
    public const int NotFound = 404;
    public const int Conflict = 409;
    public const int UnprocessableEntity = 422;
}
