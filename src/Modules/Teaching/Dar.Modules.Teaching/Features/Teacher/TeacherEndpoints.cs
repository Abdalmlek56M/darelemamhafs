namespace Dar.Modules.Teaching.Features.Teacher;

public static class TeacherEndpoints
{
    public static IEndpointRouteBuilder MapTeacherEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/teacher")
            .WithTags("teacher")
            .RequireAuthorization("teacher.portal");

        group.MapGet("/today", TodayEndpoint.Handle).WithName("TeacherToday");
        group.MapPost("/sessions/start", SessionEndpoints.Start)
            .RequireAuthorization("teacher.attendance").WithName("TeacherStartSession");
        group.MapPost("/sessions/{id:guid}/end", SessionEndpoints.End)
            .RequireAuthorization("teacher.attendance").WithName("TeacherEndSession");
        group.MapGet("/sessions/{id:guid}/roster", RosterEndpoints.Roster)
            .RequireAuthorization("teacher.students.read").WithName("TeacherRoster");
        group.MapPost("/sessions/{id:guid}/attendance", RosterEndpoints.Submit)
            .RequireAuthorization("teacher.attendance").WithName("TeacherSubmitAttendance");
        group.MapGet("/earnings", MoneyEndpoints.Earnings)
            .RequireAuthorization("teacher.earnings.self").WithName("TeacherEarnings");
        group.MapGet("/subscriptions", MoneyEndpoints.Subscriptions)
            .RequireAuthorization("teacher.subscriptions.read").WithName("TeacherSubscriptions");

        return app;
    }
}
