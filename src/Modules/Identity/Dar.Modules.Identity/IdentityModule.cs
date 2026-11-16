using System.Security.Claims;
using Dar.Common.Domain;
using Dar.Modules.Identity.Abstractions;
using Dar.Modules.Identity.Features.GetCurrentUser;
using Dar.Modules.Identity.Features.GoogleSignIn;
using Dar.Modules.Identity.Features.Logout;
using Dar.Modules.Identity.Features.PasswordSignIn;
using Dar.Modules.Identity.Features.RequestEmailOtp;
using Dar.Modules.Identity.Features.SetUserEmail;
using Dar.Modules.Identity.Features.VerifyEmailOtp;
using Dar.Modules.Identity.Infrastructure;
using Dar.Modules.Identity.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Dar.Modules.Identity;

public static class IdentityModule
{
    public static IServiceCollection AddIdentityModule(
        this IServiceCollection services,
        IConfiguration configuration,
        bool isDevelopment)
    {
        services.AddHttpContextAccessor();
        services.AddScoped<IIdentityRepository, IdentityRepository>();
        services.AddSingleton<ITicketStore, DatabaseTicketStore>();
        services.AddSingleton<OtpCodeHasher>();
        services.Configure<SmtpOptions>(configuration.GetSection("Auth:Smtp"));

        services.AddSingleton<IEmailSender>(sp =>
        {
            var config = sp.GetRequiredService<IConfiguration>();
            return string.IsNullOrWhiteSpace(config["Auth:Smtp:Host"])
                ? ActivatorUtilities.CreateInstance<LoggingEmailSender>(sp)
                : ActivatorUtilities.CreateInstance<SmtpEmailSender>(sp);
        });

        services.AddScoped<RequestEmailOtpHandler>();
        services.AddScoped<VerifyEmailOtpHandler>();
        services.AddScoped<PasswordSignInHandler>();
        services.AddScoped<GoogleSignInHandler>();
        services.AddScoped<SetUserEmailHandler>();

        services.AddAuthentication(AuthSession.Scheme)
            .AddCookie(options =>
            {
                options.Cookie.Name = "dar_session";
                options.Cookie.HttpOnly = true;
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.Cookie.SecurePolicy = isDevelopment
                    ? CookieSecurePolicy.SameAsRequest
                    : CookieSecurePolicy.Always;
                options.ExpireTimeSpan = TimeSpan.FromHours(8);
                options.SlidingExpiration = true;

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
                options.Events.OnValidatePrincipal = async context =>
                {
                    var principal = context.Principal;
                    var idValue = principal?.FindFirstValue(ClaimTypes.NameIdentifier);
                    if (!Guid.TryParse(idValue, out var userId))
                    {
                        context.RejectPrincipal();
                        await context.HttpContext.SignOutAsync(AuthSession.Scheme);
                        return;
                    }

                    var repository = context.HttpContext.RequestServices.GetRequiredService<IIdentityRepository>();
                    var user = await repository.FindByIdAsync(userId, context.HttpContext.RequestAborted);
                    var versionValue = principal?.FindFirstValue("session_version");
                    if (user is null || !int.TryParse(versionValue, out var version) || version != user.SessionVersion)
                    {
                        // Deactivated user, password/email change, or other revocation.
                        context.RejectPrincipal();
                        await context.HttpContext.SignOutAsync(AuthSession.Scheme);
                        return;
                    }

                    var oldPermissions = principal!.FindAll("permission")
                        .Select(claim => claim.Value)
                        .OrderBy(value => value, StringComparer.Ordinal)
                        .ToArray();
                    var newPermissions = user.Permissions
                        .OrderBy(value => value, StringComparer.Ordinal)
                        .ToArray();
                    if (!oldPermissions.SequenceEqual(newPermissions, StringComparer.Ordinal))
                    {
                        var claims = principal.Claims.Where(claim => claim.Type != "permission").ToList();
                        claims.AddRange(newPermissions.Select(permission => new Claim("permission", permission)));
                        context.ReplacePrincipal(new ClaimsPrincipal(new ClaimsIdentity(claims, AuthSession.Scheme)));
                        context.ShouldRenew = true;
                    }
                };
            });

        // ITicketStore is a singleton; attach it to the cookie options without
        // building a temporary service provider. Skip it when no database is
        // configured so build/liveness tests do not need PostgreSQL.
        if (!string.IsNullOrWhiteSpace(configuration.GetConnectionString("Default")))
        {
            services.AddOptions<CookieAuthenticationOptions>(AuthSession.Scheme)
                .Configure<ITicketStore>((options, store) => options.SessionStore = store);
        }

        services.AddAuthorization(options =>
        {
            foreach (var permission in PermissionCodes.All)
            {
                options.AddPolicy(permission.Code, policy =>
                    policy.RequireAuthenticatedUser().RequireClaim("permission", permission.Code));
            }

            options.AddPolicy("schedule.access", policy =>
                policy.RequireAuthenticatedUser().RequireAssertion(context =>
                    context.User.HasClaim("permission", "schedule.read") ||
                    context.User.HasClaim("permission", "schedule.edit") ||
                    context.User.HasClaim("permission", "attendance.read") ||
                    context.User.HasClaim("permission", "attendance.edit")));

            options.AddPolicy("attendance.access", policy =>
                policy.RequireAuthenticatedUser().RequireAssertion(context =>
                    context.User.HasClaim("permission", "attendance.read") ||
                    context.User.HasClaim("permission", "attendance.edit")));
        });

        return services;
    }

    public static IEndpointRouteBuilder MapIdentityEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/auth").WithTags("identity");

        group.MapRequestEmailOtp();
        group.MapVerifyEmailOtp();
        group.MapPasswordSignIn();
        group.MapGoogleSignIn();
        group.MapGetCurrentUser();
        group.MapLogout();

        app.MapSetUserEmail();

        return app;
    }
}
