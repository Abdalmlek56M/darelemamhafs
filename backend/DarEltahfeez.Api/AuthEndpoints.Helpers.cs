using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class AuthEndpoints
{
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
        var minimum = requireStrongPassword ? 6 : 1;
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

    private static async Task SignInAsync(HttpContext context, Guid id, string username, string displayName, IEnumerable<string> permissions, int sessionVersion, bool rememberMe = true)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, id.ToString()),
            new(ClaimTypes.Name, username),
            new("display_name", displayName),
            new("session_version", sessionVersion.ToString(System.Globalization.CultureInfo.InvariantCulture))
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

    private static bool FixedTimeEquals(string provided, string expected)
    {
        var providedBytes = Encoding.UTF8.GetBytes(provided);
        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        return providedBytes.Length == expectedBytes.Length &&
               CryptographicOperations.FixedTimeEquals(providedBytes, expectedBytes);
    }

    private static async Task<bool> IsActiveUserManagerAsync(NpgsqlDataSource db, Guid id, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand("""
            SELECT EXISTS(
                SELECT 1 FROM app_users u
                JOIN user_permissions p ON p.user_id=u.id AND p.permission_code='users.manage'
                WHERE u.id=@id AND u.is_active=TRUE
            );
            """);
        cmd.Parameters.AddWithValue("id", id);
        return (bool)(await cmd.ExecuteScalarAsync(ct) ?? false);
    }

    private static async Task<bool> HasOtherActiveUserManagerAsync(NpgsqlDataSource db, Guid id, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand("""
            SELECT EXISTS(
                SELECT 1 FROM app_users u
                JOIN user_permissions p ON p.user_id=u.id AND p.permission_code='users.manage'
                WHERE u.id<>@id AND u.is_active=TRUE
            );
            """);
        cmd.Parameters.AddWithValue("id", id);
        return (bool)(await cmd.ExecuteScalarAsync(ct) ?? false);
    }
}
