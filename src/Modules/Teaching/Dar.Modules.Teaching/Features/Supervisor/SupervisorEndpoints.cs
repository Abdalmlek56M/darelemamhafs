namespace Dar.Modules.Teaching.Features.Supervisor;

public static class SupervisorEndpoints
{
    public static IEndpointRouteBuilder MapSupervisorEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/supervisor").WithTags("supervisor");
        group.MapGet("/live", LiveEndpoint.Handle)
            .RequireAuthorization("supervisor.live").WithName("SupervisorLive");
        group.MapGet("/absences", AbsencesEndpoint.Handle)
            .RequireAuthorization("supervisor.absences").WithName("SupervisorAbsences");
        group.MapGet("/unpaid", UnpaidEndpoint.Handle)
            .RequireAuthorization("unpaid.access").WithName("SupervisorUnpaid");
        group.MapPost("/attendance/{id:guid}/adjust", AdjustEndpoint.Handle)
            .RequireAuthorization("attendance.correct").WithName("SupervisorAdjustAttendance");
        return app;
    }
}
