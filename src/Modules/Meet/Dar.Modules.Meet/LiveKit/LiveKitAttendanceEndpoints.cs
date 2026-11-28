using System.Security.Claims;

namespace Dar.Modules.Meet.LiveKit;

public static class LiveKitAttendanceEndpoints
{
    public static readonly HashSet<string> AllowedKinds = new(StringComparer.Ordinal)
    {
        "join",
        "heartbeat",
        "leave",
    };

    public static IEndpointRouteBuilder MapLiveKitAttendanceEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/rooms").WithTags("livekit-rooms");

        group.MapPost("/{inviteCode}/attendance/{kind}", async Task<IResult> (
            string inviteCode,
            string kind,
            ClaimsPrincipal principal,
            LiveKitRoomRepository repo,
            LiveKitParticipantRepository participants,
            CancellationToken ct) =>
        {
            var normalized = kind.Trim().ToLowerInvariant();
            if (!AllowedKinds.Contains(normalized))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["kind"] = ["نوع حدث الحضور غير صحيح."] });

            var room = await repo.GetRoomByInviteCodeAsync(inviteCode, ct);
            if (room is null) return Results.NotFound(new { message = "الغرفة غير موجودة." });

            var (userId, _) = LiveKitRoomEndpoints.ReadCaller(principal);
            var seconds = await participants.RecordAttendanceEventAsync(room.Id, userId, normalized, ct);
            return Results.Ok(new { ok = true, attendedSeconds = seconds });
        }).RequireAuthorization();

        group.MapGet("/session/{sessionId:guid}/attendance-suggestions", async Task<IResult> (
            Guid sessionId,
            ClaimsPrincipal principal,
            LiveKitParticipantRepository participants,
            CancellationToken ct) =>
        {
            var canRead = principal.HasClaim("permission", "teacher.attendance")
                || principal.HasClaim("permission", "attendance.edit")
                || principal.HasClaim("permission", "supervisor.attendance.correct");
            if (!canRead) return Results.Forbid();

            var (roomId, teacherMinutes, students) = await participants.GetSessionAttendanceSuggestionsAsync(sessionId, ct);
            return Results.Ok(new
            {
                roomId,
                teacherAttendedMinutes = teacherMinutes,
                students = students.Select(s => new
                {
                    studentId = s.StudentId,
                    userId = s.UserId,
                    attendedMinutes = s.AttendedMinutes,
                    suggestedStatus = s.SuggestedStatus,
                }),
            });
        }).RequireAuthorization();

        return app;
    }
}
