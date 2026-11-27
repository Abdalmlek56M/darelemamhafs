using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Npgsql;

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
            await AuditLogWriter.WriteAsync(db, actorId, actorName, action, "app_user", null,
                detailsJson: JsonSerializer.Serialize(new { username = username?.Trim().ToLowerInvariant() }),
                requestPath: "/api/auth/login", httpMethod: "POST", cancellationToken: ct);
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

    /// <summary>
    /// Security review (A9): a users.manage holder must not grant permission codes they do not
    /// hold themselves. On update, codes the target already has are allowed through so an
    /// unrelated profile edit keeps working; only newly added codes are checked.
    /// </summary>
    private static async Task<IResult?> ValidateGrantablePermissionsAsync(
        ClaimsPrincipal principal, NpgsqlDataSource db, Guid? targetUserId, string[]? codes, CancellationToken ct)
    {
        if (codes is null || codes.Length == 0) return null;
        var requested = codes.Distinct(StringComparer.Ordinal).ToArray();
        var notHeld = requested.Where(code => !principal.HasClaim("permission", code)).ToArray();
        if (notHeld.Length == 0) return null;
        if (targetUserId is Guid targetId)
        {
            var current = new HashSet<string>(StringComparer.Ordinal);
            await using (var existing = db.CreateCommand("SELECT permission_code FROM user_permissions WHERE user_id=@id;"))
            {
                existing.Parameters.AddWithValue("id", targetId);
                await using var reader = await existing.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct)) current.Add(reader.GetString(0));
            }
            notHeld = notHeld.Where(code => !current.Contains(code)).ToArray();
            if (notHeld.Length == 0) return null;
        }
        return Results.Json(
            new { message = "لا يمكنك منح صلاحيات لا تملكها: " + string.Join("، ", notHeld) },
            statusCode: StatusCodes.Status403Forbidden);
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

    private static void AddNullable(NpgsqlCommand command, string name, object? value) =>
        command.Parameters.AddWithValue(name, value ?? DBNull.Value);

    private static bool FixedTimeEquals(string provided, string expected)
    {
        var providedBytes = Encoding.UTF8.GetBytes(provided);
        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        return providedBytes.Length == expectedBytes.Length &&
               CryptographicOperations.FixedTimeEquals(providedBytes, expectedBytes);
    }

    private static async Task<IResult?> ValidateTeacherLinkAsync(NpgsqlDataSource db, Guid? userId, Guid? teacherId, CancellationToken ct)
    {
        if (teacherId is null) return null;

        await using (var teacher = db.CreateCommand("SELECT EXISTS(SELECT 1 FROM teachers WHERE id=@id AND is_trashed=FALSE AND status IN ('active','inactive'));"))
        {
            teacher.Parameters.AddWithValue("id", teacherId.Value);
            if (!(bool)(await teacher.ExecuteScalarAsync(ct) ?? false))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["teacherId"] = ["المعلمة غير موجودة أو مؤرشفة."] });
        }

        var linkedSql = userId is null
            ? "SELECT EXISTS(SELECT 1 FROM app_users WHERE teacher_id=@teacher);"
            : "SELECT EXISTS(SELECT 1 FROM app_users WHERE teacher_id=@teacher AND id<>@userId);";
        await using (var linked = db.CreateCommand(linkedSql))
        {
            linked.Parameters.AddWithValue("teacher", teacherId.Value);
            if (userId is not null) linked.Parameters.AddWithValue("userId", userId.Value);
            if ((bool)(await linked.ExecuteScalarAsync(ct) ?? false))
                return Results.Conflict(new { message = "هذه المعلمة مرتبطة بحساب آخر." });
        }

        return null;
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
