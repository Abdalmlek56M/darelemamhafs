using Dar.Common.Domain;
using Dar.Modules.Meet.Infrastructure;

namespace Dar.Modules.Meet.Application;

public static class MeetGuards
{
    /// <summary>
    /// Fail closed: every recording endpoint refuses to work until the Google OAuth
    /// credentials and the encryption key are configured on the host.
    /// </summary>
    public static void EnsureConfigured(MeetOptions options, MeetCrypto crypto)
    {
        if (options.IsConfigured && crypto.IsReady) return;
        throw new AppException(
            "وحدة التسجيل غير مهيأة على هذا السيرفر. المطلوب: " +
            string.Join("، ", options.MissingPrerequisites()) + ". راجع docs/19-meet-operations.md.",
            503);
    }
}
