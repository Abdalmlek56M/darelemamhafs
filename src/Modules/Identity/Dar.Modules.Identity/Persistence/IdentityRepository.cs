using Dapper;
using Dar.Modules.Identity.Abstractions;
using Dar.Modules.Identity.Domain;
using Dar.Modules.Identity.Infrastructure;
using Npgsql;

namespace Dar.Modules.Identity.Persistence;

public sealed class IdentityRepository(NpgsqlDataSource dataSource) : IIdentityRepository
{
    private static DateTimeOffset? ToDateTimeOffset(object? value) => value switch
    {
        DateTimeOffset dto => dto,
        DateTime dt => new DateTimeOffset(DateTime.SpecifyKind(dt, DateTimeKind.Utc)),
        _ => null
    };

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

    public async Task<DateTimeOffset?> GetLoginLockedUntilAsync(string username, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT locked_until FROM login_attempts WHERE username=@username;", connection);
        cmd.Parameters.AddWithValue("username", username);
        return ToDateTimeOffset(await cmd.ExecuteScalarAsync(ct));
    }

    public async Task<(int FailedAttempts, DateTimeOffset? LoginLockedUntil)> RegisterLoginFailureAsync(string username, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        // Ensure the row exists, then serialize all failure decisions on it.
        await using (var ensure = new NpgsqlCommand("INSERT INTO login_attempts(username, updated_at) VALUES(@username, now()) ON CONFLICT (username) DO NOTHING;", connection, transaction))
        {
            ensure.Parameters.AddWithValue("username", username);
            await ensure.ExecuteNonQueryAsync(ct);
        }

        int attempts;
        DateTimeOffset? lockedUntil;
        await using (var read = new NpgsqlCommand("SELECT failed_attempts::int, locked_until FROM login_attempts WHERE username=@username FOR UPDATE;", connection, transaction))
        {
            read.Parameters.AddWithValue("username", username);
            await using var reader = await read.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
            {
                await transaction.CommitAsync(ct);
                return (0, null);
            }
            attempts = reader.GetInt32(0);
            lockedUntil = reader.IsDBNull(1) ? null : reader.GetFieldValue<DateTimeOffset>(1);
        }

        var now = DateTimeOffset.UtcNow;
        // A live lock is final: concurrent failures must not increment it or extend its duration.
        if (lockedUntil is { } activeLock && activeLock > now)
        {
            await transaction.CommitAsync(ct);
            return (attempts, activeLock);
        }

        var nextAttempts = Math.Min(attempts + 1, 20);
        var delay = LoginLockoutPolicy.DelaySecondsFor(nextAttempts);
        DateTimeOffset? newLock = delay > 0 ? now.AddSeconds(delay) : null;
        await using (var update = new NpgsqlCommand("""
            UPDATE login_attempts
            SET failed_attempts=@attempts, locked_until=@lockedUntil, last_failed_at=now(), updated_at=now()
            WHERE username=@username;
            """, connection, transaction))
        {
            update.Parameters.AddWithValue("attempts", nextAttempts);
            update.Parameters.AddWithValue("lockedUntil", (object?)newLock ?? DBNull.Value);
            update.Parameters.AddWithValue("username", username);
            await update.ExecuteNonQueryAsync(ct);
        }
        await transaction.CommitAsync(ct);
        return (nextAttempts, newLock);
    }

    public async Task<(bool Allowed, DateTimeOffset? LoginLockedUntil)> TryCompleteLoginAsync(string username, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        DateTimeOffset? lockedUntil = null;
        await using (var read = new NpgsqlCommand("SELECT locked_until FROM login_attempts WHERE username=@username FOR UPDATE;", connection, transaction))
        {
            read.Parameters.AddWithValue("username", username);
            var value = await read.ExecuteScalarAsync(ct);
            lockedUntil = value switch
            {
                DateTimeOffset dto => dto,
                DateTime dt => new DateTimeOffset(DateTime.SpecifyKind(dt, DateTimeKind.Utc)),
                _ => null
            };
        }
        if (lockedUntil is { } activeLock && activeLock > DateTimeOffset.UtcNow)
        {
            await transaction.CommitAsync(ct);
            return (false, activeLock);
        }
        await using (var delete = new NpgsqlCommand("DELETE FROM login_attempts WHERE username=@username;", connection, transaction))
        {
            delete.Parameters.AddWithValue("username", username);
            await delete.ExecuteNonQueryAsync(ct);
        }
        await transaction.CommitAsync(ct);
        return (true, null);
    }

    public async Task CleanupLoginAttemptsAsync(CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT cleanup_login_attempts(50000);", connection);
        await cmd.ExecuteScalarAsync(ct);
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
