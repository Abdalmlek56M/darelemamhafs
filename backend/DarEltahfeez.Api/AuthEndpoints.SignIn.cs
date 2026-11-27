using System.Net;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class AuthEndpoints
{
    private static void MapSetupAndLogin(WebApplication app)
    {
        app.MapGet("/api/setup/status", async Task<IResult> (NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var cmd = db.CreateCommand("SELECT EXISTS(SELECT 1 FROM app_users);");
            var hasUsers = (bool)(await cmd.ExecuteScalarAsync(ct) ?? false);
            return Results.Ok(new { needsInitialAdmin = !hasUsers, schoolName = "دار الإمام حفص للقرآن والتجويد" });
        });

        app.MapPost("/api/setup/admin", async Task<IResult> (InitialAdminRequest request, HttpContext context, IConfiguration configuration, NpgsqlDataSource db, CancellationToken ct) =>
        {
            // First-run bootstrap is the highest-value takeover target. Require a configured
            // one-time token for remote callers; local desktop setup stays loopback-only.
            var configuredToken = configuration["Auth:SetupToken"];
            if (!string.IsNullOrWhiteSpace(configuredToken))
            {
                var providedToken = context.Request.Headers["X-Setup-Token"].ToString();
                if (!FixedTimeEquals(providedToken, configuredToken))
                    return Results.Json(new { message = "رمز إعداد الخادم غير صحيح." }, statusCode: StatusCodes.Status403Forbidden);
            }
            else if (context.Connection.RemoteIpAddress is not null && !IPAddress.IsLoopback(context.Connection.RemoteIpAddress))
            {
                return Results.Json(
                    new { message = "إعداد الخادم الأول متاح من الجهاز المحلي فقط. اضبط Auth:SetupToken للسماح بالإعداد عن بُعد." },
                    statusCode: StatusCodes.Status403Forbidden);
            }

            var errors = ValidateCredentials(request.Username, request.DisplayName, request.Password, requireStrongPassword: true);
            if (errors is not null) return Results.ValidationProblem(errors);

            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            try
            {
                await using (var lockCommand = new NpgsqlCommand("SELECT pg_advisory_xact_lock(73190422);", connection, transaction))
                    await lockCommand.ExecuteNonQueryAsync(ct);
                await using (var exists = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM app_users);", connection, transaction))
                {
                    if ((bool)(await exists.ExecuteScalarAsync(ct) ?? false))
                        return Results.Conflict(new { message = "تم إعداد حساب المدير بالفعل. سجّل الدخول بدلًا من إنشاء حساب أول." });
                }

                var userId = Guid.NewGuid();
                await using (var insert = new NpgsqlCommand("INSERT INTO app_users(id, username, display_name, password_hash, is_active) VALUES (@id, @username, @display, @hash, TRUE);", connection, transaction))
                {
                    insert.Parameters.AddWithValue("id", userId);
                    insert.Parameters.AddWithValue("username", request.Username.Trim().ToLowerInvariant());
                    insert.Parameters.AddWithValue("display", request.DisplayName.Trim());
                    insert.Parameters.AddWithValue("hash", Passwords.Hash(request.Password));
                    await insert.ExecuteNonQueryAsync(ct);
                }
                foreach (var permission in AppPermissions.All)
                {
                    await using var grant = new NpgsqlCommand("INSERT INTO user_permissions(user_id, permission_code) VALUES (@id, @permission);", connection, transaction);
                    grant.Parameters.AddWithValue("id", userId);
                    grant.Parameters.AddWithValue("permission", permission.Code);
                    await grant.ExecuteNonQueryAsync(ct);
                }
                await AuditLogWriter.WriteAsync(connection, transaction, userId, null, "setup.initial_admin", "app_user", userId,
                    detailsJson: JsonSerializer.Serialize(new { username = request.Username.Trim().ToLowerInvariant() }),
                    cancellationToken: ct);
                await transaction.CommitAsync(ct);
                await SignInAsync(context, userId, request.Username.Trim().ToLowerInvariant(), request.DisplayName.Trim(), AppPermissions.All.Select(p => p.Code), sessionVersion: 0);
                return Results.Ok(new UserSessionResponse(userId, request.Username.Trim().ToLowerInvariant(), request.DisplayName.Trim(), AppPermissions.All.Select(p => p.Code).ToArray()));
            }
            catch (PostgresException ex) when (ex.SqlState == "23505")
            {
                await transaction.RollbackAsync(ct);
                return Results.Conflict(new { message = "اسم المستخدم مستخدم بالفعل." });
            }
        }).RequireRateLimiting("auth");

        app.MapGet("/api/auth/config", (TurnstileVerifier turnstile) =>
            Results.Ok(new { enabled = turnstile.Enabled, siteKey = turnstile.Enabled ? turnstile.SiteKey : null }));

        app.MapPost("/api/auth/login", async Task<IResult> (LoginRequest request, HttpContext context, NpgsqlDataSource db, TurnstileVerifier turnstile, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrEmpty(request.Password))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["credentials"] = ["اكتب اسم المستخدم وكلمة المرور."] });

            var normalizedUsername = request.Username.Trim().ToLowerInvariant();
            Guid? id = null;
            string? username = null;
            string? displayName = null;
            string? passwordHash = null;
            var active = false;
            var locked = false;
            var sessionVersion = 0;
            await using (var cmd = db.CreateCommand("SELECT id, username, display_name, password_hash, is_active, is_locked, session_version FROM app_users WHERE lower(username) = @username;"))
            {
                cmd.Parameters.AddWithValue("username", normalizedUsername);
                await using var reader = await cmd.ExecuteReaderAsync(ct);
                if (await reader.ReadAsync(ct))
                {
                    id = reader.GetGuid(0);
                    username = reader.GetString(1);
                    displayName = reader.GetString(2);
                    passwordHash = reader.GetString(3);
                    active = reader.GetBoolean(4);
                    locked = reader.GetBoolean(5);
                    sessionVersion = reader.GetInt32(6);
                }
            }

            var now = DateTimeOffset.UtcNow;
            DateTimeOffset? loginLockedUntil;
            await using (var lockRead = db.CreateCommand("SELECT locked_until FROM login_attempts WHERE username=@username;"))
            {
                lockRead.Parameters.AddWithValue("username", normalizedUsername);
                var value = await lockRead.ExecuteScalarAsync(ct);
                loginLockedUntil = value switch
                {
                    DateTimeOffset dto => dto,
                    DateTime dt => new DateTimeOffset(DateTime.SpecifyKind(dt, DateTimeKind.Utc)),
                    _ => null
                };
            }
            if (loginLockedUntil is { } lockedUntil && lockedUntil > now)
            {
                var retryAfter = (int)Math.Ceiling((lockedUntil - now).TotalSeconds);
                context.Response.Headers.RetryAfter = retryAfter.ToString(System.Globalization.CultureInfo.InvariantCulture);
                await TryAuditLoginAsync(db, id, displayName, "auth.login.locked", request.Username, ct);
                return Results.Json(new { message = LoginLockoutPolicy.LockedMessage(retryAfter) }, statusCode: StatusCodes.Status429TooManyRequests);
            }

            // Turnstile (when enabled) is checked before password verification and never
            // increments the lockout counter, so a CAPTCHA failure cannot lock an account.
            var turnstileCheck = await turnstile.VerifyAsync(request.TurnstileToken, context.Connection.RemoteIpAddress?.ToString(), ct);
            if (turnstileCheck == TurnstileCheck.Rejected)
                return Results.Json(new { message = "تعذّر التحقق الأمني. أعد تحميل الصفحة وحاول مرة أخرى." }, statusCode: StatusCodes.Status400BadRequest);
            if (turnstileCheck == TurnstileCheck.UnavailableRejected)
                return Results.Json(new { message = "خدمة التحقق الأمني غير متاحة حاليًا. حاول بعد قليل." }, statusCode: StatusCodes.Status503ServiceUnavailable);

            // Only an active, unlocked account with a real password may authenticate.
            // Unknown, OTP-only, disabled and manually locked accounts always take the failure path
            // (after paying the same dummy PBKDF2 cost) and share the same response.
            var canUseRealPassword = id is not null && active && !locked
                && !string.IsNullOrWhiteSpace(passwordHash)
                && !string.Equals(passwordHash, "otp-only", StringComparison.OrdinalIgnoreCase);
            var passwordOk = canUseRealPassword
                ? Passwords.Verify(request.Password, passwordHash!)
                : Passwords.Verify(request.Password, DummyPasswordHash);
            if (!canUseRealPassword || !passwordOk)
            {
                int attempts = 0;
                DateTimeOffset? lockedAfterFailure = null;
                await using (var connection = await db.OpenConnectionAsync(ct))
                await using (var transaction = await connection.BeginTransactionAsync(ct))
                {
                    await using (var ensure = new NpgsqlCommand("INSERT INTO login_attempts(username, updated_at) VALUES(@username, now()) ON CONFLICT (username) DO NOTHING;", connection, transaction))
                    {
                        ensure.Parameters.AddWithValue("username", normalizedUsername);
                        await ensure.ExecuteNonQueryAsync(ct);
                    }
                    await using (var lockRow = new NpgsqlCommand("SELECT failed_attempts::int, locked_until FROM login_attempts WHERE username=@username FOR UPDATE;", connection, transaction))
                    {
                        lockRow.Parameters.AddWithValue("username", normalizedUsername);
                        await using var reader = await lockRow.ExecuteReaderAsync(ct);
                        if (await reader.ReadAsync(ct))
                        {
                            attempts = reader.GetInt32(0);
                            lockedAfterFailure = reader.IsDBNull(1) ? null : reader.GetFieldValue<DateTimeOffset>(1);
                        }
                    }

                    var nowInTx = DateTimeOffset.UtcNow;
                    if (lockedAfterFailure is { } existingLock && existingLock > nowInTx)
                    {
                        await transaction.CommitAsync(ct);
                    }
                    else
                    {
                        attempts = Math.Min(attempts + 1, 20);
                        var delay = LoginLockoutPolicy.DelaySecondsFor(attempts);
                        lockedAfterFailure = delay > 0 ? nowInTx.AddSeconds(delay) : null;
                        await using var update = new NpgsqlCommand("UPDATE login_attempts SET failed_attempts=@attempts, locked_until=@lockedUntil, last_failed_at=now(), updated_at=now() WHERE username=@username;", connection, transaction);
                        update.Parameters.AddWithValue("attempts", attempts);
                        update.Parameters.AddWithValue("lockedUntil", (object?)lockedAfterFailure ?? DBNull.Value);
                        update.Parameters.AddWithValue("username", normalizedUsername);
                        await update.ExecuteNonQueryAsync(ct);
                        await transaction.CommitAsync(ct);
                    }
                }
                try
                {
                    await using var cleanup = db.CreateCommand("SELECT cleanup_login_attempts(50000);");
                    await cleanup.ExecuteScalarAsync(ct);
                }
                catch { /* cleanup must never break sign-in */ }

                if (lockedAfterFailure is { } lockUntil && lockUntil > DateTimeOffset.UtcNow)
                {
                    var retryAfter = Math.Max(1, (int)Math.Ceiling((lockUntil - DateTimeOffset.UtcNow).TotalSeconds));
                    context.Response.Headers.RetryAfter = retryAfter.ToString(System.Globalization.CultureInfo.InvariantCulture);
                    await TryAuditLoginAsync(db, id, displayName, "auth.login.locked", request.Username, ct);
                    return Results.Json(new { message = LoginLockoutPolicy.LockedMessage(retryAfter) }, statusCode: StatusCodes.Status429TooManyRequests);
                }
                await TryAuditLoginAsync(db, id, displayName, "auth.login.failed", request.Username, ct);
                return Results.Unauthorized();
            }

            if (id is null || username is null || displayName is null)
                return Results.Unauthorized();

            // The final delete is serialized with the lock row: a lock written by a concurrent
            // failure between password verification and this point must not be cleared by success.
            await using (var connection = await db.OpenConnectionAsync(ct))
            await using (var transaction = await connection.BeginTransactionAsync(ct))
            {
                DateTimeOffset? lockAtSuccess = null;
                await using (var lockRow = new NpgsqlCommand("SELECT locked_until FROM login_attempts WHERE username=@username FOR UPDATE;", connection, transaction))
                {
                    lockRow.Parameters.AddWithValue("username", normalizedUsername);
                    var value = await lockRow.ExecuteScalarAsync(ct);
                    lockAtSuccess = value switch
                    {
                        DateTimeOffset dto => dto,
                        DateTime dt => new DateTimeOffset(DateTime.SpecifyKind(dt, DateTimeKind.Utc)),
                        _ => null
                    };
                }
                if (lockAtSuccess is { } activeLockAtSuccess && activeLockAtSuccess > DateTimeOffset.UtcNow)
                {
                    await transaction.CommitAsync(ct);
                    var retryAfter = Math.Max(1, (int)Math.Ceiling((activeLockAtSuccess - DateTimeOffset.UtcNow).TotalSeconds));
                    context.Response.Headers.RetryAfter = retryAfter.ToString(System.Globalization.CultureInfo.InvariantCulture);
                    await TryAuditLoginAsync(db, id, displayName, "auth.login.locked", request.Username, ct);
                    return Results.Json(new { message = LoginLockoutPolicy.LockedMessage(retryAfter) }, statusCode: StatusCodes.Status429TooManyRequests);
                }
                await using (var delete = new NpgsqlCommand("DELETE FROM login_attempts WHERE username=@username;", connection, transaction))
                {
                    delete.Parameters.AddWithValue("username", normalizedUsername);
                    await delete.ExecuteNonQueryAsync(ct);
                }
                await transaction.CommitAsync(ct);
            }
            var permissions = await LoadPermissions(db, id.Value, ct);
            await SignInAsync(context, id.Value, username, displayName, permissions, sessionVersion, request.RememberMe);
            await TryAuditLoginAsync(db, id, displayName, "auth.login", username, ct);
            return Results.Ok(new UserSessionResponse(id.Value, username, displayName, permissions));
        }).RequireRateLimiting("auth");

    }
}
