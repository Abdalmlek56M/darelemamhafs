using Dar.Modules.Teaching.Features.Notifications;
using Dar.Modules.Teaching.Features.Supervisor;
using Dar.Modules.Teaching.Features.Teacher;

namespace Dar.Modules.Teaching;

public static class TeachingModule
{
    public static IServiceCollection AddTeachingModule(this IServiceCollection services) => services;

    public static IEndpointRouteBuilder MapTeachingEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapTeacherEndpoints();
        app.MapSupervisorEndpoints();
        app.MapNotificationEndpoints();
        return app;
    }
}
