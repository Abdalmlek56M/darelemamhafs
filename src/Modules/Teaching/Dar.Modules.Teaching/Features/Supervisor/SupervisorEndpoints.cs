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

        group.MapGet("/students", StudentsEndpoint.List)
            .RequireAuthorization("supervisor.students.read").WithName("SupervisorStudents");
        group.MapGet("/students/{id:guid}", StudentsEndpoint.Detail)
            .RequireAuthorization("supervisor.students.read").WithName("SupervisorStudentDetail");
        group.MapPost("/students/{id:guid}/notes", SupervisionNotesEndpoint.AddStudentNote)
            .RequireAuthorization("supervisor.students.notes").WithName("SupervisorAddStudentNote");

        group.MapGet("/circles", CirclesEndpoint.List)
            .RequireAuthorization("supervisor.circles.read").WithName("SupervisorCircles");
        group.MapGet("/circles/{id:guid}", CirclesEndpoint.Detail)
            .RequireAuthorization("supervisor.circles.read").WithName("SupervisorCircleDetail");

        group.MapGet("/teachers", TeachersEndpoint.List)
            .RequireAuthorization("supervisor.teachers.read").WithName("SupervisorTeachers");
        group.MapGet("/teachers/{id:guid}", TeachersEndpoint.Detail)
            .RequireAuthorization("supervisor.teachers.read").WithName("SupervisorTeacherDetail");
        group.MapPost("/teachers/{id:guid}/notes", SupervisionNotesEndpoint.AddTeacherNote)
            .RequireAuthorization("supervisor.teachers.notes").WithName("SupervisorAddTeacherNote");

        group.MapGet("/attendance/teachers", AttendanceEndpoints.TeacherAttendance)
            .RequireAuthorization("supervisor.absences").WithName("SupervisorTeacherAttendance");
        group.MapGet("/attendance/students", AttendanceEndpoints.StudentAttendance)
            .RequireAuthorization("supervisor.absences").WithName("SupervisorStudentAttendance");

        group.MapGet("/scopes", SupervisionScopeEndpoints.ListUsers)
            .RequireAuthorization("users.manage").WithName("SupervisorScopes");
        group.MapGet("/scopes/options", SupervisionScopeEndpoints.Options)
            .RequireAuthorization("users.manage").WithName("SupervisorScopeOptions");
        group.MapPut("/scopes/{id:guid}", SupervisionScopeEndpoints.Set)
            .RequireAuthorization("users.manage").WithName("SupervisorScopeSet");
        return app;
    }
}
