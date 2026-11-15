using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static class AuthEndpoints
{
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
        await using (var cmd = db.CreateCommand("SELECT username, display_name FROM app_users WHERE id=@id AND is_active=TRUE;"))
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
                new("display_name", displayName)
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

        app.MapPost("/api/setup/admin", async Task<IResult> (InitialAdminRequest request, HttpContext context, NpgsqlDataSource db, CancellationToken ct) =>
        {
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
                await SignInAsync(context, userId, request.Username.Trim().ToLowerInvariant(), request.DisplayName.Trim(), AppPermissions.All.Select(p => p.Code));
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

            Guid id;
            string username;
            string displayName;
            string passwordHash;
            bool active;
            await using (var cmd = db.CreateCommand("SELECT id, username, display_name, password_hash, is_active FROM app_users WHERE username = @username;"))
            {
                cmd.Parameters.AddWithValue("username", request.Username.Trim().ToLowerInvariant());
                await using var reader = await cmd.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct))
                {
                    await TryAuditLoginAsync(db, null, null, "auth.login.failed", request.Username, ct);
                    return Results.Unauthorized();
                }
                id = reader.GetGuid(0);
                username = reader.GetString(1);
                displayName = reader.GetString(2);
                passwordHash = reader.GetString(3);
                active = reader.GetBoolean(4);
            }
            if (!active || !Passwords.Verify(request.Password, passwordHash))
            {
                await TryAuditLoginAsync(db, id, displayName, "auth.login.failed", request.Username, ct);
                return Results.Unauthorized();
            }
            var permissions = await LoadPermissions(db, id, ct);
            await SignInAsync(context, id, username, displayName, permissions, request.RememberMe);
            await TryAuditLoginAsync(db, id, displayName, "auth.login", username, ct);
            return Results.Ok(new UserSessionResponse(id, username, displayName, permissions));
        }).RequireRateLimiting("auth");

        app.MapPost("/api/auth/change-password", async Task<IResult> (ChangePasswordRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var userId = GetActorId(principal);
            if (userId == Guid.Empty) return Results.Unauthorized();
            if (string.IsNullOrEmpty(request.CurrentPassword))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["currentPassword"] = ["اكتب كلمة المرور الحالية."] });
            if (string.IsNullOrEmpty(request.NewPassword) || request.NewPassword.Length < 12 || request.NewPassword.Length > 200)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["newPassword"] = ["كلمة المرور الجديدة يجب أن تكون بين 12 و200 حرف."] });

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

            await using (var update = db.CreateCommand("UPDATE app_users SET password_hash=@hash,updated_at=now() WHERE id=@id AND is_active=TRUE;"))
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
            return Results.Ok(new { changed = true });
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
            await using var cmd = db.CreateCommand("SELECT id, username, display_name, is_active, created_at FROM app_users ORDER BY created_at, username;");
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                list.Add(new AdminUserResponse(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetBoolean(3), reader.GetFieldValue<DateTimeOffset>(4), []));
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
            var id = Guid.NewGuid();
            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            try
            {
                await using (var insert = new NpgsqlCommand("INSERT INTO app_users(id, username, display_name, password_hash, is_active) VALUES (@id, @username, @display, @hash, TRUE);", connection, transaction))
                {
                    insert.Parameters.AddWithValue("id", id);
                    insert.Parameters.AddWithValue("username", request.Username.Trim().ToLowerInvariant());
                    insert.Parameters.AddWithValue("display", request.DisplayName.Trim());
                    insert.Parameters.AddWithValue("hash", Passwords.Hash(request.Password!));
                    await insert.ExecuteNonQueryAsync(ct);
                }
                await ReplacePermissions(connection, transaction, id, request.PermissionCodes, ct);
                await transaction.CommitAsync(ct);
                return Results.Created($"/api/admin/users/{id}", new { id, username = request.Username.Trim().ToLowerInvariant(), displayName = request.DisplayName.Trim(), isActive = true, permissionCodes = request.PermissionCodes });
            }
            catch (PostgresException ex) when (ex.SqlState == "23505")
            {
                await transaction.RollbackAsync(ct);
                return Results.Conflict(new { message = "اسم المستخدم مستخدم بالفعل." });
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
            if (!string.IsNullOrEmpty(request.Password) && request.Password.Length < 12)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["password"] = ["كلمة المرور الجديدة يجب ألا تقل عن 12 حرفًا."] });

            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            try
            {
                var sql = string.IsNullOrEmpty(request.Password)
                    ? "UPDATE app_users SET username=@username, display_name=@display, is_active=@active, updated_at=now() WHERE id=@id;"
                    : "UPDATE app_users SET username=@username, display_name=@display, is_active=@active, password_hash=@hash, updated_at=now() WHERE id=@id;";
                await using (var update = new NpgsqlCommand(sql, connection, transaction))
                {
                    update.Parameters.AddWithValue("id", id);
                    update.Parameters.AddWithValue("username", request.Username.Trim().ToLowerInvariant());
                    update.Parameters.AddWithValue("display", request.DisplayName.Trim());
                    update.Parameters.AddWithValue("active", request.IsActive);
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

        users.MapDelete("/{id:guid}", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (GetActorId(principal) == id) return Results.Conflict(new { message = "لا يمكنك تعطيل حسابك الحالي." });
            await using var cmd = db.CreateCommand("UPDATE app_users SET is_active=FALSE, updated_at=now() WHERE id=@id RETURNING id;");
            cmd.Parameters.AddWithValue("id", id);
            var result = await cmd.ExecuteScalarAsync(ct);
            if (result is null) return Results.NotFound();
            return Results.Ok(new { id, isActive = false });
        });
    }

    private static async Task TryAuditLoginAsync(
        NpgsqlDataSource db,
        Guid? actorId,
        string? actorName,
        string action,
        string? username,
        CancellationToken ct)
    {
        try
        {
            await using var cmd = db.CreateCommand(
                "INSERT INTO audit_log(actor_user_id,actor_display_name,action_code,entity_type,entity_id,details,request_path,http_method,can_restore) " +
                "VALUES(@actor,@name,@action,'app_user',NULL,jsonb_build_object('username',@username),'/api/auth/login','POST',FALSE);");
            cmd.Parameters.Add("actor", NpgsqlDbType.Uuid).Value = actorId.HasValue ? actorId.Value : DBNull.Value;
            cmd.Parameters.AddWithValue("name", (object?)actorName ?? DBNull.Value);
            cmd.Parameters.AddWithValue("action", action);
            cmd.Parameters.AddWithValue("username", (object?)username?.Trim().ToLowerInvariant() ?? DBNull.Value);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch
        {
            // Login must not fail because the audit write failed. The request logger still records it.
        }
    }

    private static Dictionary<string, string[]>? ValidateCredentials(string? username, string? displayName, string? password, bool requireStrongPassword)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(username) || username.Trim().Length < 3 || username.Trim().Length > 100)
            errors["username"] = ["اسم المستخدم يجب أن يكون بين 3 و100 حرف."];
        if (string.IsNullOrWhiteSpace(displayName) || displayName.Trim().Length > 160)
            errors["displayName"] = ["اسم العرض مطلوب وبحد أقصى 160 حرفًا."];
        var minimum = requireStrongPassword ? 12 : 1;
        if (string.IsNullOrEmpty(password) || password.Length < minimum || password.Length > 200)
            errors["password"] = [$"كلمة المرور يجب ألا تقل عن {minimum} حرفًا وألا تتجاوز 200 حرف."];
        return errors.Count == 0 ? null : errors;
    }

    private static Dictionary<string, string[]>? ValidatePermissionList(string[]? codes)
    {
        if (codes is null) return new Dictionary<string, string[]> { ["permissionCodes"] = ["حدد الصلاحيات المطلوبة للحساب."] };
        var unknown = codes.Where(code => !AppPermissions.IsKnown(code)).Distinct().ToArray();
        return unknown.Length == 0 ? null : new Dictionary<string, string[]> { ["permissionCodes"] = ["توجد صلاحيات غير معروفة."] };
    }

    private static async Task ReplacePermissions(NpgsqlConnection connection, NpgsqlTransaction transaction, Guid id, string[] codes, CancellationToken ct)
    {
        await using (var delete = new NpgsqlCommand("DELETE FROM user_permissions WHERE user_id=@id;", connection, transaction))
        {
            delete.Parameters.AddWithValue("id", id);
            await delete.ExecuteNonQueryAsync(ct);
        }
        foreach (var code in codes.Distinct(StringComparer.Ordinal))
        {
            await using var insert = new NpgsqlCommand("INSERT INTO user_permissions(user_id, permission_code) VALUES (@id, @code);", connection, transaction);
            insert.Parameters.AddWithValue("id", id);
            insert.Parameters.AddWithValue("code", code);
            await insert.ExecuteNonQueryAsync(ct);
        }
    }

    private static async Task<string[]> LoadPermissions(NpgsqlDataSource db, Guid id, CancellationToken ct)
    {
        var codes = new List<string>();
        await using var cmd = db.CreateCommand("SELECT permission_code FROM user_permissions WHERE user_id=@id ORDER BY permission_code;");
        cmd.Parameters.AddWithValue("id", id);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) codes.Add(reader.GetString(0));
        return codes.ToArray();
    }

    private static async Task SignInAsync(HttpContext context, Guid id, string username, string displayName, IEnumerable<string> permissions, bool rememberMe = true)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, id.ToString()),
            new(ClaimTypes.Name, username),
            new("display_name", displayName)
        };
        claims.AddRange(permissions.Select(permission => new Claim("permission", permission)));
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
        var properties = new AuthenticationProperties { IsPersistent = rememberMe, AllowRefresh = true };
        if (rememberMe) properties.ExpiresUtc = DateTimeOffset.UtcNow.AddDays(30);
        await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, properties);
    }

    private static UserSessionResponse ToSession(ClaimsPrincipal principal) => new(
        GetActorId(principal), principal.Identity?.Name ?? string.Empty,
        principal.FindFirstValue("display_name") ?? principal.Identity?.Name ?? string.Empty,
        principal.FindAll("permission").Select(c => c.Value).Distinct().ToArray());

    private static Guid GetActorId(ClaimsPrincipal principal) => Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : Guid.Empty;
}

public sealed record InitialAdminRequest(string Username, string DisplayName, string Password);
public sealed record LoginRequest(string Username, string Password, bool RememberMe = false);
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);
public sealed record UserSessionResponse(Guid Id, string Username, string DisplayName, string[] PermissionCodes);
public sealed record PermissionResponse(string Code, string NameAr);
public sealed class AdminUserResponse(Guid id, string username, string displayName, bool isActive, DateTimeOffset createdAt, string[] permissionCodes)
{
    public Guid Id { get; } = id;
    public string Username { get; } = username;
    public string DisplayName { get; } = displayName;
    public bool IsActive { get; } = isActive;
    public DateTimeOffset CreatedAt { get; } = createdAt;
    public string[] PermissionCodes { get; set; } = permissionCodes;
}
public sealed record AdminUserWriteRequest(string Username, string DisplayName, string? Password, bool IsActive, string[] PermissionCodes);
