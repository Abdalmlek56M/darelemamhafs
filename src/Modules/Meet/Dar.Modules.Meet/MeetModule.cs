using Dar.Modules.Meet.Application;
using Dar.Modules.Meet.Features.Calendar;
using Dar.Modules.Meet.Features.Circles;
using Dar.Modules.Meet.Features.Events;
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
        services.AddScoped<CalendarSyncService>();
        services.AddHostedService<Workers.CalendarSyncWorker>();

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
        return app;
    }
}
