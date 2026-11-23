using Dar.Modules.Meet.Application;
using Dar.Modules.Meet.Features.Calendar;
using Dar.Modules.Meet.Features.Circles;
using Dar.Modules.Meet.Features.Events;
using Dar.Modules.Meet.Features.Internal;
using Dar.Modules.Meet.Infrastructure;
using Dar.Modules.Meet.Persistence;

namespace Dar.Modules.Meet;

public static class MeetModule
{
    public static IServiceCollection AddMeetModule(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<MeetOptions>(configuration.GetSection(MeetOptions.SectionName));
        services.AddSingleton<MeetCrypto>();
        services.AddSingleton<MeetGoogleOAuth>();
        services.AddSingleton<MeetGoogleCalendarClient>();
        services.AddScoped<MeetCalendarRepository>();
        services.AddScoped<MeetScopeRepository>();
        services.AddScoped<MeetBotJobRepository>();
        services.AddScoped<CalendarSyncService>();
        services.AddHostedService<Workers.CalendarSyncWorker>();
        services.AddHostedService<Workers.MeetSchedulerWorker>();

        services.AddAuthorization(options =>
        {
            foreach (var permission in MeetPermissions.All)
            {
                options.AddPolicy(permission.Code, policy =>
                    policy.RequireAuthenticatedUser().RequireClaim("permission", permission.Code));
            }
        });

        return services;
    }

    public static IEndpointRouteBuilder MapMeetEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/meet").WithTags("meet");
        group.MapMeetCalendar();
        group.MapMeetEvents();
        group.MapMeetCircles();

        // Loopback-only control plane for the recorder. Nginx never proxies this prefix and
        // every call needs the service token (Meet__InternalToken).
        var internalGroup = app.MapGroup("/internal/meet").WithTags("meet-internal");
        internalGroup.MapMeetBotJobs();

        return app;
    }
}
