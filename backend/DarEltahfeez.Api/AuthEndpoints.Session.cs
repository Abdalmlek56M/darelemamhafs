using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class AuthEndpoints
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

        // FINAL B7: the cookie ticket carries no permission claims (see
        // SlimAdminCookieTicketDataFormat); the request principal is rebuilt from the current
        // database permissions on every request instead. SQL changes take effect on the next
        // request and the cookie never grows with the permission catalog.
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, userId.ToString()),
            new(ClaimTypes.Name, username),
            new("display_name", displayName),
            new("session_version", sessionVersion.ToString(System.Globalization.CultureInfo.InvariantCulture))
        };
        claims.AddRange(currentPermissions.Select(permission => new Claim("permission", permission)));
        context.ReplacePrincipal(new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));
    }
}
