using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Dar.Modules.Identity.Abstractions;
using Dar.Modules.Identity.Domain;

namespace Dar.Modules.Identity.Infrastructure;

/// <summary>
/// Reads the legacy admin cookie (<c>DarEltahfeez.Admin</c>, issued by dar-legacy on 5080)
/// so the modular API can serve admin screens on the same origin without a second login.
/// See ADR-0006: shared Data Protection key ring + explicit legacy ticket purpose.
/// The bridge is read-only: it never signs in, never renews and never rewrites the cookie.
/// </summary>
public static class AdminSessionBridge
{
    public const string Scheme = "dar_admin_bridge";
    public const string PolicyScheme = "Dar.Session";
    public const string CookieName = "DarEltahfeez.Admin";
    public const string ApplicationName = "DarEltahfeez";
    public const string KeysPathConfigurationKey = "DataProtection:KeysPath";

    /// <summary>Scheme name used by dar-legacy; part of the cookie ticket purpose.</summary>
    private const string LegacyTicketSchemeName = "Cookies";
    private const string AuthSessionCookieName = "dar_session";

    public static IServiceCollection AddAdminSessionBridge(
        this IServiceCollection services,
        IConfiguration configuration,
        bool isDevelopment)
    {
        services.AddAuthentication()
            .AddCookie(Scheme, options =>
            {
                options.Cookie = new CookieBuilder
                {
                    Name = CookieName,
                    HttpOnly = true,
                    SameSite = SameSiteMode.Strict,
                    SecurePolicy = isDevelopment ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always,
                    Path = "/"
                };
                options.ExpireTimeSpan = TimeSpan.FromHours(8);
                options.SlidingExpiration = false;
                options.Events.OnValidatePrincipal = ValidatePrincipalAsync;
                options.Events.OnRedirectToLogin = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return Task.CompletedTask;
                };
                options.Events.OnRedirectToAccessDenied = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    return Task.CompletedTask;
                };
            })
            .AddPolicyScheme(PolicyScheme, "Dar session selector", options =>
            {
                options.ForwardDefaultSelector = context =>
                    context.Request.Cookies.ContainsKey(AuthSessionCookieName)
                        ? AuthSession.Scheme
                        : context.Request.Cookies.ContainsKey(CookieName)
                            ? Scheme
                            : AuthSession.Scheme;
            });

        // The legacy ticket is protected with the "Cookies" purpose; the bridge must use the
        // exact same purpose string even though its own scheme has a different name.
        services.AddOptions<CookieAuthenticationOptions>(Scheme)
            .Configure<IDataProtectionProvider>((options, provider) =>
            {
                var protector = provider.CreateProtector(
                    "Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationMiddleware",
                    LegacyTicketSchemeName,
                    "v2");
                options.TicketDataFormat = new TicketDataFormat(protector);
            });

        services.Configure<AuthenticationOptions>(options =>
        {
            options.DefaultScheme = PolicyScheme;
            options.DefaultAuthenticateScheme = PolicyScheme;
            options.DefaultChallengeScheme = PolicyScheme;
            options.DefaultSignInScheme = AuthSession.Scheme;
        });

        // Same key ring and application name as dar-legacy (ADR-0006). Without a configured
        // path the framework default is used, which is fine for local development.
        var keysPath = configuration[KeysPathConfigurationKey];
        var dataProtection = services.AddDataProtection().SetApplicationName(ApplicationName);
        if (!string.IsNullOrWhiteSpace(keysPath))
            dataProtection.PersistKeysToFileSystem(new DirectoryInfo(keysPath));

        return services;
    }

    private static async Task ValidatePrincipalAsync(CookieValidatePrincipalContext context)
    {
        var principal = context.Principal;
        if (!Guid.TryParse(principal?.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
        {
            context.RejectPrincipal();
            return;
        }

        AuthUser? user;
        try
        {
            var repository = context.HttpContext.RequestServices.GetRequiredService<IIdentityRepository>();
            user = await repository.FindByIdAsync(userId, context.HttpContext.RequestAborted);
        }
        catch (Exception)
        {
            // A database outage must not silently authenticate a stale cookie.
            context.RejectPrincipal();
            return;
        }

        if (user is null)
        {
            context.RejectPrincipal();
            return;
        }

        var versionClaim = principal?.FindFirstValue("session_version");
        if (!int.TryParse(versionClaim, out var version) || version != user.SessionVersion)
        {
            context.RejectPrincipal();
            return;
        }

        var current = principal!.FindAll("permission")
            .Select(claim => claim.Value)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        var fresh = user.Permissions.OrderBy(value => value, StringComparer.Ordinal).ToArray();
        if (current.SequenceEqual(fresh, StringComparer.Ordinal)) return;

        // Permissions moved: use the fresh set for this request without rewriting the legacy cookie.
        var claims = principal.Claims.Where(claim => claim.Type != "permission").ToList();
        claims.AddRange(fresh.Select(permission => new Claim("permission", permission)));
        context.ReplacePrincipal(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme)));
    }
}
