namespace Dar.Modules.Teaching.Features.Teacher;

using Dar.Modules.Teaching.Features.Requests;

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

        group.MapGet("/calendar", TeacherCalendarEndpoints.Calendar)
            .RequireAuthorization("teacher.calendar").WithName("TeacherCalendar");
        group.MapGet("/history", TeacherCalendarEndpoints.History)
            .RequireAuthorization("teacher.history.self").WithName("TeacherHistory");

        group.MapGet("/requests", TeacherRequestEndpoints.List)
            .RequireAuthorization("teacher.requests").WithName("TeacherRequests");
        group.MapPost("/requests", TeacherRequestEndpoints.Create)
            .RequireAuthorization("teacher.requests").WithName("TeacherCreateRequest");
        group.MapPost("/requests/{id:guid}/cancel", TeacherRequestEndpoints.Cancel)
            .RequireAuthorization("teacher.requests").WithName("TeacherCancelRequest");

        return app;
    }
}
