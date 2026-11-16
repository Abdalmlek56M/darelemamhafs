using Dar.Modules.Identity.Domain;

namespace Dar.Modules.Identity.Abstractions;

public interface IIdentityRepository
{
    Task<AuthUser?> FindByEmailAsync(string email, CancellationToken ct);
    Task<AuthUser?> FindByUsernameAsync(string username, CancellationToken ct);
    Task<AuthUser?> FindByGoogleSubjectAsync(string subject, CancellationToken ct);
    Task<AuthUser?> FindByIdAsync(Guid id, CancellationToken ct);

    Task<bool> EmailExistsAsync(string email, Guid? excludeUserId, CancellationToken ct);
    Task<bool> UpdateEmailAsync(Guid userId, string email, Guid actorId, CancellationToken ct);
    Task UpdatePasswordAsync(Guid userId, string passwordHash, CancellationToken ct);
    Task LinkGoogleSubjectAsync(Guid userId, string subject, Guid actorId, CancellationToken ct);

    Task CreateOtpAsync(string email, string codeHash, DateTimeOffset expiresAt, int maxAttempts, string? ip, CancellationToken ct);
    Task<bool> IsOtpRequestThrottledAsync(string email, CancellationToken ct);
    Task<OtpRecord?> GetLatestOtpAsync(string email, CancellationToken ct);
    Task ConsumeOtpAsync(Guid otpId, CancellationToken ct);
    Task IncrementOtpAttemptsAsync(Guid otpId, CancellationToken ct);
}
