namespace Dar.Modules.Identity.Infrastructure;

/// <summary>P1-1 progressive login lockout policy (must match the legacy API values).</summary>
internal static class LoginLockoutPolicy
{
    public const int MaxAttemptsBeforeLock = 5;

    public static int DelaySecondsFor(int failedAttempts)
    {
        if (failedAttempts < MaxAttemptsBeforeLock) return 0;
        var exponent = Math.Min(failedAttempts - MaxAttemptsBeforeLock, 5);
        return Math.Min(30 * (1 << exponent), 900);
    }

    public static string LockedMessage(int retryAfterSeconds) =>
        retryAfterSeconds >= 60
            ? $"تم إيقاف محاولات الدخول مؤقتًا. أعد المحاولة بعد {Math.Ceiling(retryAfterSeconds / 60.0):0} دقيقة."
            : $"تم إيقاف محاولات الدخول مؤقتًا. أعد المحاولة بعد {retryAfterSeconds} ثانية.";
}
