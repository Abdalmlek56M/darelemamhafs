using Dar.Modules.Meet.Application;
using Dar.Modules.Meet.Features.Calendar;
using Dar.Modules.Meet.Features.Circles;
using Dar.Modules.Meet.Features.Events;
using Dar.Modules.Meet.Features.Control;
using Dar.Modules.Meet.Features.Internal;
using Dar.Modules.Meet.Features.Media;
using Dar.Modules.Meet.Infrastructure;
using Dar.Modules.Meet.LiveKit;
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
        services.AddScoped<MeetMediaRepository>();
        services.AddScoped<MeetAlertRepository>();
        services.AddScoped<CalendarSyncService>();
        services.AddHostedService<Workers.CalendarSyncWorker>();
        services.AddHostedService<Workers.MeetSchedulerWorker>();
        services.AddHostedService<Workers.MeetAlertNotifier>();
        services.AddHttpClient("meet-telegram", client => client.Timeout = TimeSpan.FromSeconds(15));
        services.AddHttpClient("livekit-server", client => client.Timeout = TimeSpan.FromSeconds(10));
        services.AddSingleton(_ => LiveKitOptions.FromConfiguration(configuration));
        services.AddSingleton<LiveKitTokenService>();
        services.AddSingleton<LiveKitServerClient>();
        services.AddScoped<LiveKitRoomRepository>();


        return services;
    }

    public static IEndpointRouteBuilder MapMeetEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/meet").WithTags("meet");
        group.MapMeetCalendar();
        group.MapMeetEvents();
        group.MapMeetCircles();
        group.MapMeetMedia();
        group.MapMeetControl();

        // Loopback-only control plane for the recorder. Nginx never proxies this prefix and
        // every call needs the service token (Meet__InternalToken).
        var internalGroup = app.MapGroup("/internal/meet").WithTags("meet-internal");
        internalGroup.MapMeetBotJobs();
        app.MapLiveKitRoomEndpoints();
        app.MapLiveKitAccessEndpoints();
        app.MapLiveKitHostControlEndpoints();
        app.MapLiveKitAttendanceEndpoints();

        return app;
    }
}
