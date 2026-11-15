using System.Security.Claims;
using Dar.Modules.Identity.Domain;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace Dar.Modules.Identity.Infrastructure;

public sealed record UserSessionResponse(
    Guid Id,
    string Username,
    string DisplayName,
    string? Email,
    string[] PermissionCodes);

public static class AuthSession
{
    public const string Scheme = CookieAuthenticationDefaults.AuthenticationScheme;

    public static async Task SignInAsync(
        HttpContext httpContext,
        AuthUser user,
        bool persistent,
        CancellationToken ct)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.Username),
            new("display_name", user.DisplayName)
        };

        if (!string.IsNullOrWhiteSpace(user.Email))
            claims.Add(new Claim(ClaimTypes.Email, user.Email));

        claims.AddRange(user.Permissions.Select(code => new Claim("permission", code)));

        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme));
        var properties = new AuthenticationProperties
        {
            IsPersistent = persistent,
            AllowRefresh = true
        };

        if (persistent)
            properties.ExpiresUtc = DateTimeOffset.UtcNow.AddDays(30);

        await httpContext.SignInAsync(Scheme, principal, properties);
    }

    public static UserSessionResponse FromUser(AuthUser user) => new(
        user.Id,
        user.Username,
        user.DisplayName,
        user.Email,
        user.Permissions);

    public static UserSessionResponse FromPrincipal(ClaimsPrincipal principal)
    {
        var id = Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var parsed)
            ? parsed
            : Guid.Empty;

        return new UserSessionResponse(
            id,
            principal.FindFirstValue(ClaimTypes.Name) ?? string.Empty,
            principal.FindFirstValue("display_name") ?? principal.FindFirstValue(ClaimTypes.Name) ?? string.Empty,
            principal.FindFirstValue(ClaimTypes.Email),
            principal.FindAll("permission").Select(c => c.Value).Distinct(StringComparer.Ordinal).ToArray());
    }
}
