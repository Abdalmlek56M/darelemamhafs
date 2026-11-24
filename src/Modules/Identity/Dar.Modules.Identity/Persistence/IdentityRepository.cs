using Dapper;
using Dar.Modules.Identity.Abstractions;
using Dar.Modules.Identity.Domain;
using Dar.Modules.Identity.Infrastructure;
using Npgsql;

namespace Dar.Modules.Identity.Persistence;

public sealed class IdentityRepository(NpgsqlDataSource dataSource) : IIdentityRepository
{
    private const string UserSelect = """
        SELECT u.id AS Id,
               u.username AS Username,
               u.display_name AS DisplayName,
               u.email AS Email,
               u.password_hash AS PasswordHash,
               u.teacher_id AS TeacherId,
               u.is_active AS IsActive,
               u.is_locked AS IsLocked,
               u.failed_login_attempts AS FailedLoginAttempts,
               u.login_locked_until AS LoginLockedUntil,
               u.session_version AS SessionVersion,
               COALESCE(
                   (SELECT array_agg(up.permission_code ORDER BY up.permission_code)
                    FROM user_permissions up WHERE up.user_id=u.id),
                   ARRAY[]::text[]
               ) AS Permissions
        FROM app_users u
        """;

    public async Task<AuthUser?> FindByEmailAsync(string email, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        return await connection.QuerySingleOrDefaultAsync<AuthUser>(
            UserSelect + " WHERE lower(u.email)=lower(@email) AND u.is_active=TRUE AND u.is_locked=FALSE LIMIT 1;",
            new { email });
    }

    public async Task<AuthUser?> FindByUsernameAsync(string username, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        return await connection.QuerySingleOrDefaultAsync<AuthUser>(
            UserSelect + " WHERE lower(u.username)=lower(@username) AND u.is_active=TRUE AND u.is_locked=FALSE LIMIT 1;",
            new { username });
    }

    public async Task<AuthUser?> FindByUsernameForLoginAsync(string username, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        return await connection.QuerySingleOrDefaultAsync<AuthUser>(
            UserSelect + " WHERE lower(u.username)=lower(@username) AND u.is_active=TRUE LIMIT 1;",
            new { username });
    }

    public async Task<(int FailedAttempts, DateTimeOffset? LoginLockedUntil)> RegisterLoginFailureAsync(Guid userId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        int attempts;
        await using (var fail = new NpgsqlCommand("UPDATE app_users SET failed_login_attempts = failed_login_attempts + 1, last_failed_login_at = now() WHERE id=@id RETURNING failed_login_attempts::int;", connection))
        {
            fail.Parameters.AddWithValue("id", userId);
            attempts = (int)(await fail.ExecuteScalarAsync(ct) ?? 1);
        }
        var delay = LoginLockoutPolicy.DelaySecondsFor(attempts);
        if (delay <= 0) return (attempts, null);
        await using var lockCmd = new NpgsqlCommand("UPDATE app_users SET login_locked_until = now() + (@delay * INTERVAL '1 second') WHERE id=@id RETURNING login_locked_until;", connection);
        lockCmd.Parameters.AddWithValue("delay", delay);
        lockCmd.Parameters.AddWithValue("id", userId);
        var lockedUntil = await lockCmd.ExecuteScalarAsync(ct);
        // Npgsql returns timestamptz scalars as DateTime; normalize to DateTimeOffset (UTC).
        DateTimeOffset? normalized = lockedUntil switch
        {
            DateTimeOffset dto => dto,
            DateTime dt => new DateTimeOffset(DateTime.SpecifyKind(dt, DateTimeKind.Utc)),
            _ => null
        };
        return (attempts, normalized);
    }

    public async Task ClearLoginFailuresAsync(Guid userId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("UPDATE app_users SET failed_login_attempts=0, login_locked_until=NULL, last_failed_login_at=NULL WHERE id=@id;", connection);
        cmd.Parameters.AddWithValue("id", userId);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<AuthUser?> FindByGoogleSubjectAsync(string subject, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        return await connection.QuerySingleOrDefaultAsync<AuthUser>(
            UserSelect + " WHERE u.google_subject=@subject AND u.is_active=TRUE AND u.is_locked=FALSE LIMIT 1;",
            new { subject });
    }

    public async Task<AuthUser?> FindByIdAsync(Guid id, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        return await connection.QuerySingleOrDefaultAsync<AuthUser>(
            UserSelect + " WHERE u.id=@id AND u.is_active=TRUE AND u.is_locked=FALSE LIMIT 1;",
            new { id });
    }

    public async Task<bool> EmailExistsAsync(string email, Guid? excludeUserId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        return await connection.ExecuteScalarAsync<bool>("""
            SELECT EXISTS(
                SELECT 1 FROM app_users
                WHERE lower(email)=lower(@email)
                  AND (@excludeUserId IS NULL OR id<>@excludeUserId)
            );
            """, new { email, excludeUserId });
    }

    public async Task UpdatePasswordAsync(Guid userId, string passwordHash, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await connection.ExecuteAsync("""
            UPDATE app_users
            SET password_hash=@passwordHash, session_version=session_version+1, updated_at=now()
            WHERE id=@userId AND is_active=TRUE AND is_locked=FALSE;
            """, new { userId, passwordHash });
    }

    public async Task<bool> UpdateEmailAsync(Guid userId, string email, Guid actorId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        var updated = await connection.ExecuteAsync("""
            UPDATE app_users
            SET email=@email, session_version=session_version+1, updated_at=now()
            WHERE id=@userId AND is_active=TRUE;
            """, new { userId, email }, transaction);

        if (updated == 0)
        {
            await transaction.RollbackAsync(ct);
            return false;
        }

        await connection.ExecuteAsync("""
            INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details,request_path,http_method,can_restore)
            VALUES(@actorId,'user.email.update','app_user',@userId,
                   jsonb_build_object('email',@email),'/api/v1/users/'||@userId||'/email','PUT',FALSE);
            """, new { actorId, userId, email }, transaction);

        await transaction.CommitAsync(ct);
        return true;
    }

    public async Task LinkGoogleSubjectAsync(Guid userId, string subject, Guid actorId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await connection.ExecuteAsync("""
            UPDATE app_users
            SET google_subject=@subject, updated_at=now()
            WHERE id=@userId AND is_active=TRUE AND google_subject IS NULL;
            """, new { userId, subject }, transaction);

        await connection.ExecuteAsync("""
            INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details,request_path,http_method,can_restore)
            VALUES(@actorId,'user.google.link','app_user',@userId,
                   jsonb_build_object('linked',TRUE),'/api/v1/auth/google','POST',FALSE);
            """, new { actorId, userId }, transaction);

        await transaction.CommitAsync(ct);
    }

    public async Task CreateOtpAsync(
        string email,
        string codeHash,
        DateTimeOffset expiresAt,
        int maxAttempts,
        string? ip,
        CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await connection.ExecuteAsync("""
            UPDATE auth_email_otps
            SET consumed_at=now()
            WHERE lower(email)=lower(@email) AND consumed_at IS NULL;
            """, new { email }, transaction);

        await connection.ExecuteAsync("""
            INSERT INTO auth_email_otps(email,code_hash,expires_at,max_attempts,request_ip)
            VALUES(@email,@codeHash,@expiresAt,@maxAttempts,@ip);
            """, new { email, codeHash, expiresAt, maxAttempts, ip }, transaction);

        await transaction.CommitAsync(ct);
    }

    public async Task<bool> IsOtpRequestThrottledAsync(string email, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        return await connection.ExecuteScalarAsync<bool>("""
            SELECT EXISTS(
                SELECT 1 FROM auth_email_otps
                WHERE lower(email)=lower(@email)
                  AND created_at > now() - interval '60 seconds'
            ) OR (
                SELECT COUNT(*) FROM auth_email_otps
                WHERE lower(email)=lower(@email)
                  AND created_at > now() - interval '1 hour'
            ) >= 5;
            """, new { email });
    }

    public async Task<OtpRecord?> GetLatestOtpAsync(string email, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        return await connection.QuerySingleOrDefaultAsync<OtpRecord>("""
            SELECT id AS Id,
                   email AS Email,
                   code_hash AS CodeHash,
                   attempts AS Attempts,
                   max_attempts AS MaxAttempts,
                   expires_at AS ExpiresAt,
                   consumed_at AS ConsumedAt
            FROM auth_email_otps
            WHERE lower(email)=lower(@email) AND consumed_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1;
            """, new { email });
    }

    public async Task ConsumeOtpAsync(Guid otpId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await connection.ExecuteAsync("""
            UPDATE auth_email_otps SET consumed_at=now()
            WHERE id=@otpId AND consumed_at IS NULL;
            """, new { otpId });
    }

    public async Task IncrementOtpAttemptsAsync(Guid otpId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await connection.ExecuteAsync("""
            UPDATE auth_email_otps SET attempts=attempts+1 WHERE id=@otpId;
            """, new { otpId });
    }
}
