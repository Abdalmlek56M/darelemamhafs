using System.Net;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class AuthEndpoints
{
    // Verified for unknown usernames so the response time does not reveal whether the account exists.
    private static readonly string DummyPasswordHash = Passwords.Hash("p11-dummy-password-not-a-real-account");

    public static async Task ValidatePrincipalAsync(CookieValidatePrincipalContext context)
    {
        if (!Guid.TryParse(context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return;
        }

        var db = context.HttpContext.RequestServices.GetRequiredService<NpgsqlDataSource>();
        string username;
        string displayName;
        int sessionVersion;
        await using (var cmd = db.CreateCommand("SELECT username, display_name, session_version FROM app_users WHERE id=@id AND is_active=TRUE AND is_locked=FALSE;"))
        {
            cmd.Parameters.AddWithValue("id", userId);
            await using var reader = await cmd.ExecuteReaderAsync(context.HttpContext.RequestAborted);
            if (!await reader.ReadAsync(context.HttpContext.RequestAborted))
            {
                context.RejectPrincipal();
                await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                return;
            }
            username = reader.GetString(0);
            displayName = reader.GetString(1);
            sessionVersion = reader.GetInt32(2);
        }

        var oldVersion = context.Principal?.FindFirstValue("session_version");
        if (!string.Equals(oldVersion, sessionVersion.ToString(System.Globalization.CultureInfo.InvariantCulture), StringComparison.Ordinal))
        {
            // Password reset, deactivation, or another credential change revoked this cookie.
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return;
        }

        var currentPermissions = new List<string>();
        await using (var cmd = db.CreateCommand("SELECT permission_code FROM user_permissions WHERE user_id=@id ORDER BY permission_code;"))
        {
            cmd.Parameters.AddWithValue("id", userId);
            await using var reader = await cmd.ExecuteReaderAsync(context.HttpContext.RequestAborted);
            while (await reader.ReadAsync(context.HttpContext.RequestAborted)) currentPermissions.Add(reader.GetString(0));
        }

        var oldPermissions = context.Principal?.FindAll("permission").Select(c => c.Value).OrderBy(x => x, StringComparer.Ordinal).ToArray() ?? [];
        var newPermissions = currentPermissions.OrderBy(x => x, StringComparer.Ordinal).ToArray();
        var oldName = context.Principal?.FindFirstValue(ClaimTypes.Name);
        var oldDisplay = context.Principal?.FindFirstValue("display_name");
        if (!oldPermissions.SequenceEqual(newPermissions, StringComparer.Ordinal) || oldName != username || oldDisplay != displayName)
        {
            var claims = new List<Claim>
            {
                new(ClaimTypes.NameIdentifier, userId.ToString()),
                new(ClaimTypes.Name, username),
                new("display_name", displayName),
                new("session_version", sessionVersion.ToString(System.Globalization.CultureInfo.InvariantCulture))
            };
            claims.AddRange(newPermissions.Select(permission => new Claim("permission", permission)));
            context.ReplacePrincipal(new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));
            context.ShouldRenew = true;
        }
    }

    public static void Map(WebApplication app)
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
                await using (var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id, action_code, entity_type, entity_id, details) VALUES (@id, 'setup.initial_admin', 'app_user', @id, jsonb_build_object('username', @username));", connection, transaction))
                {
                    audit.Parameters.AddWithValue("id", userId);
                    audit.Parameters.AddWithValue("username", request.Username.Trim().ToLowerInvariant());
                    await audit.ExecuteNonQueryAsync(ct);
                }
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

        app.MapPost("/api/auth/login", async Task<IResult> (LoginRequest request, HttpContext context, NpgsqlDataSource db, CancellationToken ct) =>
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

            // Manual admin lock stays a permanent 401; the progressive lock returns 429.
            if (id is not null && (!active || locked))
            {
                await TryAuditLoginAsync(db, id, displayName, "auth.login.failed", request.Username, ct);
                return Results.Unauthorized();
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

            // Unknown usernames still run a real PBKDF2 verification against a dummy hash.
            var passwordOk = id is not null
                ? Passwords.Verify(request.Password, passwordHash!)
                : Passwords.Verify(request.Password, DummyPasswordHash);
            if (!passwordOk)
            {
                int attemptsAfterFailure;
                DateTimeOffset? lockedAfterFailure;
                await using (var fail = db.CreateCommand("""
                    INSERT INTO login_attempts(username, failed_attempts, last_failed_at, updated_at)
                    VALUES (@username, 1, now(), now())
                    ON CONFLICT (username) DO UPDATE
                    SET failed_attempts = LEAST(login_attempts.failed_attempts + 1, 20),
                        last_failed_at = now(),
                        updated_at = now(),
                        locked_until = CASE
                            WHEN login_attempts.failed_attempts + 1 >= 5
                            THEN now() + make_interval(secs => LEAST(900, 30 * (1 << LEAST(login_attempts.failed_attempts + 1 - 5, 5))))
                            ELSE login_attempts.locked_until
                        END
                    RETURNING failed_attempts::int, locked_until;
                    """))
                {
                    fail.Parameters.AddWithValue("username", normalizedUsername);
                    await using var reader = await fail.ExecuteReaderAsync(ct);
                    await reader.ReadAsync(ct);
                    attemptsAfterFailure = reader.GetInt32(0);
                    lockedAfterFailure = reader.IsDBNull(1) ? null : reader.GetFieldValue<DateTimeOffset>(1);
                }
                try
                {
                    await using var cleanup = db.CreateCommand("SELECT cleanup_login_attempts(50000);");
                    await cleanup.ExecuteScalarAsync(ct);
                }
                catch { /* cleanup must never break sign-in */ }

                if (lockedAfterFailure is { } lockUntil && lockUntil > DateTimeOffset.UtcNow)
                {
                    var retryAfter = (int)Math.Ceiling((lockUntil - DateTimeOffset.UtcNow).TotalSeconds);
                    context.Response.Headers.RetryAfter = retryAfter.ToString(System.Globalization.CultureInfo.InvariantCulture);
                    await TryAuditLoginAsync(db, id, displayName, "auth.login.locked", request.Username, ct);
                    return Results.Json(new { message = LoginLockoutPolicy.LockedMessage(retryAfter) }, statusCode: StatusCodes.Status429TooManyRequests);
                }
                await TryAuditLoginAsync(db, id, displayName, "auth.login.failed", request.Username, ct);
                _ = attemptsAfterFailure;
                return Results.Unauthorized();
            }

            if (id is null || username is null || displayName is null)
                return Results.Unauthorized();

            await using (var reset = db.CreateCommand("DELETE FROM login_attempts WHERE username=@username;"))
            {
                reset.Parameters.AddWithValue("username", normalizedUsername);
                await reset.ExecuteNonQueryAsync(ct);
            }
            var permissions = await LoadPermissions(db, id.Value, ct);
            await SignInAsync(context, id.Value, username, displayName, permissions, sessionVersion, request.RememberMe);
            await TryAuditLoginAsync(db, id, displayName, "auth.login", username, ct);
            return Results.Ok(new UserSessionResponse(id.Value, username, displayName, permissions));
        }).RequireRateLimiting("auth");

        app.MapPost("/api/auth/change-password", async Task<IResult> (ChangePasswordRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var userId = GetActorId(principal);
            if (userId == Guid.Empty) return Results.Unauthorized();
            if (string.IsNullOrEmpty(request.CurrentPassword))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["currentPassword"] = ["اكتب كلمة المرور الحالية."] });
            if (string.IsNullOrEmpty(request.NewPassword) || request.NewPassword.Length < 6 || request.NewPassword.Length > 200)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["newPassword"] = ["كلمة المرور الجديدة يجب أن تكون بين 6 و200 حرف."] });

            string storedHash;
            await using (var current = db.CreateCommand("SELECT password_hash FROM app_users WHERE id=@id AND is_active=TRUE;"))
            {
                current.Parameters.AddWithValue("id", userId);
                var value = await current.ExecuteScalarAsync(ct);
                if (value is not string hash) return Results.Unauthorized();
                storedHash = hash;
            }
            if (!Passwords.Verify(request.CurrentPassword, storedHash))
                return Results.BadRequest(new { message = "كلمة المرور الحالية غير صحيحة." });
            if (Passwords.Verify(request.NewPassword, storedHash))
                return Results.BadRequest(new { message = "اختَر كلمة مرور مختلفة عن الحالية." });

            await using (var update = db.CreateCommand("UPDATE app_users SET password_hash=@hash,session_version=session_version+1,updated_at=now() WHERE id=@id AND is_active=TRUE;"))
            {
                update.Parameters.AddWithValue("id", userId);
                update.Parameters.AddWithValue("hash", Passwords.Hash(request.NewPassword));
                if (await update.ExecuteNonQueryAsync(ct) == 0) return Results.Unauthorized();
            }
            try
            {
                await SystemAdminEndpoints.InsertAuditAsync(db, userId, principal.FindFirst("display_name")?.Value,
                    "auth.password.change", "app_users", userId, null,
                    JsonSerializer.Serialize(new { passwordChanged = true }), "/api/auth/change-password", "POST", false, ct);
            }
            catch { /* Password change has already committed; do not misreport it as failed because audit logging failed. */ }
            return Results.Ok(new { changed = true, reauthenticate = true, message = "تم تغيير كلمة المرور. سجّل الدخول من جديد." });
        }).RequireAuthorization();

        app.MapGet("/api/auth/me", (ClaimsPrincipal user) => Results.Ok(ToSession(user)))
            .RequireAuthorization();

        app.MapPost("/api/auth/logout", async Task<IResult> (HttpContext context) =>
        {
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.Ok(new { success = true });
        }).RequireAuthorization();

        var users = app.MapGroup("/api/admin/users").RequireAuthorization("users.manage");
        app.MapGet("/api/admin/permissions", () => Results.Ok(AppPermissions.All.Select(p => new PermissionResponse(p.Code, p.NameAr))))
            .RequireAuthorization("users.manage");
        users.MapGet("", async Task<IResult> (NpgsqlDataSource db, CancellationToken ct) =>
        {
            var list = new List<AdminUserResponse>();
            await using var cmd = db.CreateCommand("""
                SELECT id, username, display_name, is_active, is_locked, teacher_id, lock_reason, created_at,
                       COALESCE((SELECT array_agg(scope_id) FROM app_user_scopes s
                                 WHERE s.user_id = app_users.id AND s.scope_type = 'circle'), ARRAY[]::uuid[]) AS scope_circles,
                       COALESCE((SELECT array_agg(scope_id) FROM app_user_scopes s
                                 WHERE s.user_id = app_users.id AND s.scope_type = 'teacher'), ARRAY[]::uuid[]) AS scope_teachers
                FROM app_users
                ORDER BY created_at, username;
                """);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                list.Add(new AdminUserResponse(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.GetBoolean(3),
                    reader.GetBoolean(4),
                    reader.IsDBNull(5) ? null : reader.GetGuid(5),
                    reader.IsDBNull(6) ? null : reader.GetString(6),
                    reader.GetFieldValue<DateTimeOffset>(7),
                    [],
                    reader.GetFieldValue<Guid[]>(8),
                    reader.GetFieldValue<Guid[]>(9)));
            }
            await reader.CloseAsync();
            foreach (var user in list)
                user.PermissionCodes = await LoadPermissions(db, user.Id, ct);
            return Results.Ok(list);
        });

        users.MapPost("", async Task<IResult> (AdminUserWriteRequest request, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var errors = ValidateCredentials(request.Username, request.DisplayName, request.Password, true);
            if (errors is not null) return Results.ValidationProblem(errors);
            var permissionErrors = ValidatePermissionList(request.PermissionCodes);
            if (permissionErrors is not null) return Results.ValidationProblem(permissionErrors);
            var linkError = await ValidateTeacherLinkAsync(db, null, request.TeacherId, ct);
            if (linkError is not null) return linkError;
            if (request.IsLocked && string.IsNullOrWhiteSpace(request.LockReason))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["lockReason"] = ["اكتب سبب قفل الحساب."] });
            var id = Guid.NewGuid();
            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            try
            {
                await using (var insert = new NpgsqlCommand("""
                    INSERT INTO app_users(id, username, display_name, password_hash, is_active, is_locked, teacher_id, locked_at, lock_reason)
                    VALUES (@id, @username, @display, @hash, TRUE, @locked, @teacher,
                            CASE WHEN @locked THEN now() ELSE NULL END,
                            CASE WHEN @locked THEN @lockReason ELSE NULL END);
                    """, connection, transaction))
                {
                    insert.Parameters.AddWithValue("id", id);
                    insert.Parameters.AddWithValue("username", request.Username.Trim().ToLowerInvariant());
                    insert.Parameters.AddWithValue("display", request.DisplayName.Trim());
                    insert.Parameters.AddWithValue("hash", Passwords.Hash(request.Password!));
                    insert.Parameters.AddWithValue("locked", request.IsLocked);
                    AddNullable(insert, "teacher", request.TeacherId);
                    AddNullable(insert, "lockReason", request.IsLocked ? request.LockReason?.Trim() : null);
                    await insert.ExecuteNonQueryAsync(ct);
                }
                await ReplacePermissions(connection, transaction, id, request.PermissionCodes, ct);
                await transaction.CommitAsync(ct);
                return Results.Created($"/api/admin/users/{id}", new { id, username = request.Username.Trim().ToLowerInvariant(), displayName = request.DisplayName.Trim(), isActive = true, isLocked = request.IsLocked, teacherId = request.TeacherId, permissionCodes = request.PermissionCodes });
            }
            catch (PostgresException ex) when (ex.SqlState == "23505")
            {
                await transaction.RollbackAsync(ct);
                return Results.Conflict(new { message = ex.ConstraintName == "ux_app_users_teacher_id" ? "هذه المعلمة مرتبطة بحساب آخر." : "اسم المستخدم مستخدم بالفعل." });
            }
        });

        users.MapPut("/{id:guid}", async Task<IResult> (Guid id, AdminUserWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.DisplayName) || request.DisplayName.Trim().Length > 160)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["displayName"] = ["اسم العرض مطلوب وبحد أقصى 160 حرفًا."] });
            if (string.IsNullOrWhiteSpace(request.Username) || request.Username.Trim().Length > 100)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["username"] = ["اسم المستخدم مطلوب وبحد أقصى 100 حرف."] });
            var permissionErrors = ValidatePermissionList(request.PermissionCodes);
            if (permissionErrors is not null) return Results.ValidationProblem(permissionErrors);
            var actorId = GetActorId(principal);
            if (actorId == id && !request.IsActive)
                return Results.Conflict(new { message = "لا يمكنك تعطيل حسابك الحالي. استخدم حساب مدير آخر." });
            if (actorId == id && !request.PermissionCodes.Contains("users.manage", StringComparer.Ordinal))
                return Results.Conflict(new { message = "لا يمكنك إزالة صلاحية إدارة الحسابات من حسابك الحالي. استخدم حساب مدير آخر." });
            var removesUserManager = !request.IsActive || !request.PermissionCodes.Contains("users.manage", StringComparer.Ordinal);
            if (removesUserManager && await IsActiveUserManagerAsync(db, id, ct) && !await HasOtherActiveUserManagerAsync(db, id, ct))
                return Results.Conflict(new { message = "لا يمكن تعطيل آخر حساب مدير أو إزالة صلاحية إدارة الحسابات منه. أضف مديرًا آخر أولًا." });
            if (!string.IsNullOrEmpty(request.Password) && request.Password.Length < 6)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["password"] = ["كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف."] });

            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            try
            {
                var bumpSession = !request.IsActive || !string.IsNullOrEmpty(request.Password);
                var sql = string.IsNullOrEmpty(request.Password)
                    ? "UPDATE app_users SET username=@username, display_name=@display, is_active=@active, session_version=session_version+CASE WHEN @bump THEN 1 ELSE 0 END, updated_at=now() WHERE id=@id;"
                    : "UPDATE app_users SET username=@username, display_name=@display, is_active=@active, password_hash=@hash, session_version=session_version+CASE WHEN @bump THEN 1 ELSE 0 END, updated_at=now() WHERE id=@id;";
                await using (var update = new NpgsqlCommand(sql, connection, transaction))
                {
                    update.Parameters.AddWithValue("id", id);
                    update.Parameters.AddWithValue("username", request.Username.Trim().ToLowerInvariant());
                    update.Parameters.AddWithValue("display", request.DisplayName.Trim());
                    update.Parameters.AddWithValue("active", request.IsActive);
                    update.Parameters.AddWithValue("bump", bumpSession);
                    if (!string.IsNullOrEmpty(request.Password)) update.Parameters.AddWithValue("hash", Passwords.Hash(request.Password));
                    if (await update.ExecuteNonQueryAsync(ct) == 0) return Results.NotFound();
                }
                await ReplacePermissions(connection, transaction, id, request.PermissionCodes, ct);
                await transaction.CommitAsync(ct);
                return Results.Ok(new { id, username = request.Username.Trim().ToLowerInvariant(), displayName = request.DisplayName.Trim(), isActive = request.IsActive, permissionCodes = request.PermissionCodes });
            }
            catch (PostgresException ex) when (ex.SqlState == "23505")
            {
                await transaction.RollbackAsync(ct);
                return Results.Conflict(new { message = "اسم المستخدم مستخدم بالفعل." });
            }
        });

        users.MapPut("/{id:guid}/access", async Task<IResult> (Guid id, AdminUserAccessRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var actorId = GetActorId(principal);
            if (actorId == id && request.IsLocked)
                return Results.Conflict(new { message = "لا يمكنك قفل حسابك الحالي. استخدم حساب مدير آخر." });
            if (request.IsLocked && string.IsNullOrWhiteSpace(request.LockReason))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["lockReason"] = ["اكتب سبب قفل الحساب."] });
            var linkError = await ValidateTeacherLinkAsync(db, id, request.TeacherId, ct);
            if (linkError is not null) return linkError;

            var replaceScopes = request.ScopeCircleIds is not null || request.ScopeTeacherIds is not null;
            var scopeCircles = (request.ScopeCircleIds ?? []).Distinct().ToArray();
            var scopeTeachers = (request.ScopeTeacherIds ?? []).Distinct().ToArray();

            if (scopeCircles.Length > 0)
            {
                await using var valid = db.CreateCommand("SELECT COUNT(*) FROM circles WHERE id = ANY(@ids) AND is_trashed = FALSE;");
                valid.Parameters.AddWithValue("ids", scopeCircles);
                if (Convert.ToInt32(await valid.ExecuteScalarAsync(ct) ?? 0) != scopeCircles.Length)
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["scopeCircleIds"] = ["بعض الحلقات المحددة غير موجودة."] });
            }

            if (scopeTeachers.Length > 0)
            {
                await using var valid = db.CreateCommand("SELECT COUNT(*) FROM teachers WHERE id = ANY(@ids) AND is_trashed = FALSE;");
                valid.Parameters.AddWithValue("ids", scopeTeachers);
                if (Convert.ToInt32(await valid.ExecuteScalarAsync(ct) ?? 0) != scopeTeachers.Length)
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["scopeTeacherIds"] = ["بعض المعلمات المحددة غير موجودة."] });
            }

            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            try
            {
                bool currentLocked;
                Guid? currentTeacherId;
                await using (var current = new NpgsqlCommand("SELECT is_locked, teacher_id FROM app_users WHERE id=@id FOR UPDATE;", connection, transaction))
                {
                    current.Parameters.AddWithValue("id", id);
                    await using var reader = await current.ExecuteReaderAsync(ct);
                    if (!await reader.ReadAsync(ct)) return Results.NotFound();
                    currentLocked = reader.GetBoolean(0);
                    currentTeacherId = reader.IsDBNull(1) ? null : reader.GetGuid(1);
                }

                var changed = request.IsLocked != currentLocked || request.TeacherId != currentTeacherId;
                var lockReason = request.IsLocked ? request.LockReason?.Trim() : null;
                await using (var update = new NpgsqlCommand("""
                    UPDATE app_users
                    SET is_locked=@locked, teacher_id=@teacher, lock_reason=@lockReason,
                        locked_at=CASE WHEN @locked THEN COALESCE(locked_at, now()) ELSE NULL END,
                        locked_by=CASE WHEN @locked THEN COALESCE(locked_by, @actor) ELSE NULL END,
                        session_version=session_version+CASE WHEN @changed THEN 1 ELSE 0 END,
                        updated_at=now()
                    WHERE id=@id;
                    """, connection, transaction))
                {
                    update.Parameters.AddWithValue("id", id);
                    update.Parameters.AddWithValue("locked", request.IsLocked);
                    update.Parameters.AddWithValue("changed", changed);
                    update.Parameters.AddWithValue("actor", actorId);
                    AddNullable(update, "teacher", request.TeacherId);
                    AddNullable(update, "lockReason", lockReason);
                    if (await update.ExecuteNonQueryAsync(ct) == 0) return Results.NotFound();
                }

                if (replaceScopes)
                {
                    await using (var clear = new NpgsqlCommand("DELETE FROM app_user_scopes WHERE user_id=@id;", connection, transaction))
                    {
                        clear.Parameters.AddWithValue("id", id);
                        await clear.ExecuteNonQueryAsync(ct);
                    }
                    foreach (var circle in scopeCircles)
                    {
                        await using var insert = new NpgsqlCommand("""
                            INSERT INTO app_user_scopes(user_id, scope_type, scope_id, created_by)
                            VALUES (@user, 'circle', @scope, @actor);
                            """, connection, transaction);
                        insert.Parameters.AddWithValue("user", id);
                        insert.Parameters.AddWithValue("scope", circle);
                        insert.Parameters.AddWithValue("actor", actorId);
                        await insert.ExecuteNonQueryAsync(ct);
                    }
                    foreach (var teacher in scopeTeachers)
                    {
                        await using var insert = new NpgsqlCommand("""
                            INSERT INTO app_user_scopes(user_id, scope_type, scope_id, created_by)
                            VALUES (@user, 'teacher', @scope, @actor);
                            """, connection, transaction);
                        insert.Parameters.AddWithValue("user", id);
                        insert.Parameters.AddWithValue("scope", teacher);
                        insert.Parameters.AddWithValue("actor", actorId);
                        await insert.ExecuteNonQueryAsync(ct);
                    }
                }

                await using (var audit = new NpgsqlCommand("""
                    INSERT INTO audit_log(actor_user_id, actor_display_name, action_code, entity_type, entity_id, details, request_path, http_method, can_restore)
                    VALUES (@actor, @name, 'user.access.update', 'app_user', @id,
                            jsonb_build_object('isLocked', CAST(@locked AS boolean), 'teacherId', CAST(@teacher AS uuid),
                                               'scopeCircles', COALESCE(CAST(@scopeCircles AS uuid[]), '{}'::uuid[]),
                                               'scopeTeachers', COALESCE(CAST(@scopeTeachers AS uuid[]), '{}'::uuid[])),
                            '/api/admin/users/' || CAST(@id AS text) || '/access', 'PUT', FALSE);
                    """, connection, transaction))
                {
                    audit.Parameters.AddWithValue("actor", actorId);
                    audit.Parameters.AddWithValue("name", principal.FindFirstValue("display_name") ?? "مدير النظام");
                    audit.Parameters.AddWithValue("id", id);
                    audit.Parameters.AddWithValue("locked", request.IsLocked);
                    AddNullable(audit, "teacher", request.TeacherId);
                    audit.Parameters.AddWithValue("scopeCircles", scopeCircles);
                    audit.Parameters.AddWithValue("scopeTeachers", scopeTeachers);
                    await audit.ExecuteNonQueryAsync(ct);
                }

                await transaction.CommitAsync(ct);
                return Results.Ok(new { id, isLocked = request.IsLocked, teacherId = request.TeacherId, lockReason });
            }
            catch (PostgresException ex) when (ex.SqlState == "23505")
            {
                await transaction.RollbackAsync(ct);
                return Results.Conflict(new { message = "هذه المعلمة مرتبطة بحساب آخر." });
            }
        });

        users.MapDelete("/{id:guid}", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (GetActorId(principal) == id) return Results.Conflict(new { message = "لا يمكنك تعطيل حسابك الحالي." });
            if (await IsActiveUserManagerAsync(db, id, ct) && !await HasOtherActiveUserManagerAsync(db, id, ct))
                return Results.Conflict(new { message = "لا يمكن تعطيل آخر حساب مدير. أضف مديرًا آخر أولًا." });
            await using var cmd = db.CreateCommand("UPDATE app_users SET is_active=FALSE, session_version=session_version+1, updated_at=now() WHERE id=@id RETURNING id;");
            cmd.Parameters.AddWithValue("id", id);
            var result = await cmd.ExecuteScalarAsync(ct);
            if (result is null) return Results.NotFound();
            return Results.Ok(new { id, isActive = false });
        });
    }

}
