namespace Dar.Modules.Identity.Domain;

/// <summary>
/// Mutable Dapper materialization target. The repository maps columns by property name.
/// </summary>
public sealed class AuthUser
{
    public Guid Id { get; set; }
    public string Username { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string? Email { get; set; }
    public string? PasswordHash { get; set; }
    public Guid? TeacherId { get; set; }
    public bool IsActive { get; set; }
    public bool IsLocked { get; set; }
    public int FailedLoginAttempts { get; set; }
    public DateTimeOffset? LoginLockedUntil { get; set; }
    public int SessionVersion { get; set; }
    public string[] Permissions { get; set; } = [];

    public bool HasPassword =>
        !string.IsNullOrWhiteSpace(PasswordHash) &&
        !string.Equals(PasswordHash, "otp-only", StringComparison.Ordinal);
}

public sealed class OtpRecord
{
    public Guid Id { get; set; }
    public string Email { get; set; } = "";
    public string CodeHash { get; set; } = "";
    public int Attempts { get; set; }
    public int MaxAttempts { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? ConsumedAt { get; set; }
}
