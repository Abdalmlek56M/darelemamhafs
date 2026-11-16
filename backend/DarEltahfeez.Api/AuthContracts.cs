namespace DarEltahfeez.Api;

public sealed record InitialAdminRequest(string Username, string DisplayName, string Password);
public sealed record LoginRequest(string Username, string Password, bool RememberMe = false);
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);
public sealed record UserSessionResponse(Guid Id, string Username, string DisplayName, string[] PermissionCodes);
public sealed record PermissionResponse(string Code, string NameAr);
public sealed class AdminUserResponse(Guid id, string username, string displayName, bool isActive, bool isLocked, Guid? teacherId, string? lockReason, DateTimeOffset createdAt, string[] permissionCodes)
{
    public Guid Id { get; } = id;
    public string Username { get; } = username;
    public string DisplayName { get; } = displayName;
    public bool IsActive { get; } = isActive;
    public bool IsLocked { get; } = isLocked;
    public Guid? TeacherId { get; } = teacherId;
    public string? LockReason { get; } = lockReason;
    public DateTimeOffset CreatedAt { get; } = createdAt;
    public string[] PermissionCodes { get; set; } = permissionCodes;
}
public sealed record AdminUserWriteRequest(string Username, string DisplayName, string? Password, bool IsActive, string[] PermissionCodes, Guid? TeacherId = null, bool IsLocked = false, string? LockReason = null);
public sealed record AdminUserAccessRequest(Guid? TeacherId, bool IsLocked, string? LockReason);
