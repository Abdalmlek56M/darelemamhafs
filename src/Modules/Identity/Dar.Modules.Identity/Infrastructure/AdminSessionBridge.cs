using System.Security.Claims;
using System.Text.Encodings.Web;
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

    /// <summary>Cookie name of the teacher/supervisor session (see IdentityModule).</summary>
    public const string SessionCookieName = "dar_session";
    /// <summary>Sent by the teacher portal on every request so it never falls back to the admin cookie.</summary>
    public const string TeacherPortalHeader = "X-Dar-Portal";
    public const string TeacherPortalHeaderValue = "teacher";

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
            // Tries the admin cookie first, then the teacher/supervisor session. Choosing a
            // scheme by cookie presence alone let a stale dar_session (issued by a previous
            // key ring) mask a valid admin cookie and turned every /api/v1 call into 401.
            .AddScheme<AuthenticationSchemeOptions, DarSessionHandler>(PolicyScheme, "Dar session selector", _ => { });

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
        var logger = context.HttpContext.RequestServices
            .GetRequiredService<ILoggerFactory>()
            .CreateLogger("Dar.Modules.Identity.AdminSessionBridge");

        var principal = context.Principal;
        if (!Guid.TryParse(principal?.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
        {
            logger.LogInformation("Legacy admin cookie rejected: no usable user id claim.");
            context.RejectPrincipal();
            return;
        }

        AuthUser? user;
        try
        {
            var repository = context.HttpContext.RequestServices.GetRequiredService<IIdentityRepository>();
            user = await repository.FindByIdAsync(userId, context.HttpContext.RequestAborted);
        }
        catch (Exception exception)
        {
            // A database outage must not silently authenticate a stale cookie.
            logger.LogWarning(exception, "Legacy admin cookie rejected: the user lookup failed.");
            context.RejectPrincipal();
            return;
        }

        if (user is null)
        {
            logger.LogInformation("Legacy admin cookie rejected: user {UserId} is missing, inactive or locked.", userId);
            context.RejectPrincipal();
            return;
        }

        var versionClaim = principal?.FindFirstValue("session_version");
        if (!int.TryParse(versionClaim, out var version) || version != user.SessionVersion)
        {
            logger.LogInformation(
                "Legacy admin cookie rejected: session version changed for {UserId} (cookie {CookieVersion}, current {CurrentVersion}).",
                userId,
                versionClaim,
                user.SessionVersion);
            context.RejectPrincipal();
            return;
        }

        var current = principal!.FindAll("permission")
            .Select(claim => claim.Value)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        var fresh = user.Permissions.OrderBy(value => value, StringComparer.Ordinal).ToArray();
        var currentTeacherId = principal.FindFirstValue("teacher_id");
        var freshTeacherId = user.TeacherId?.ToString();
        if (current.SequenceEqual(fresh, StringComparer.Ordinal)
            && string.Equals(currentTeacherId, freshTeacherId, StringComparison.Ordinal)) return;

        // Permissions or teacher link moved: use the fresh set for this request without rewriting the legacy cookie.
        logger.LogInformation("Legacy admin cookie refreshed in memory for {UserId}: claims changed.", userId);
        var claims = principal.Claims.Where(claim => claim.Type is not "permission" and not "teacher_id").ToList();
        claims.AddRange(fresh.Select(permission => new Claim("permission", permission)));
        if (!string.IsNullOrWhiteSpace(freshTeacherId))
            claims.Add(new Claim("teacher_id", freshTeacherId));
        context.ReplacePrincipal(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme)));
    }
}

/// <summary>
/// Authenticates whichever Dar session is valid: the legacy admin cookie first, then the
/// teacher/supervisor session. A single request may legitimately carry both cookies, and a
/// stale session cookie must never mask a valid admin cookie (that caused production 401s).
/// </summary>
internal sealed class DarSessionHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory loggerFactory,
    UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, loggerFactory, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        // The teacher portal explicitly marks its requests. It must use only its own session,
        // never the admin bridge cookie, even when both exist in the same browser.
        if (string.Equals(
                Request.Headers[AdminSessionBridge.TeacherPortalHeader].ToString(),
                AdminSessionBridge.TeacherPortalHeaderValue,
                StringComparison.OrdinalIgnoreCase))
        {
            var teacherSession = await Context.AuthenticateAsync(AuthSession.Scheme);
            return teacherSession.Succeeded ? teacherSession : AuthenticateResult.NoResult();
        }

        if (Request.Cookies.ContainsKey(AdminSessionBridge.CookieName))
        {
            var admin = await Context.AuthenticateAsync(AdminSessionBridge.Scheme);
            if (admin.Succeeded) return admin;
        }

        if (Request.Cookies.ContainsKey(AdminSessionBridge.SessionCookieName))
        {
            var session = await Context.AuthenticateAsync(AuthSession.Scheme);
            if (session.Succeeded) return session;
        }

        return AuthenticateResult.NoResult();
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties) =>
        Context.ChallengeAsync(AuthSession.Scheme, properties);

    protected override Task HandleForbiddenAsync(AuthenticationProperties properties) =>
        Context.ForbidAsync(AuthSession.Scheme, properties);
}
