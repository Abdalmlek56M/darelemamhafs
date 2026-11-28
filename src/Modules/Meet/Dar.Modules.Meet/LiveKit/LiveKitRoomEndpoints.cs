using System.Security.Claims;

namespace Dar.Modules.Meet.LiveKit;

public sealed record OpenRoomRequest(
    Guid CircleId,
    Guid? SessionId = null,
    string? Title = null,
    string? AccessMode = null,
    bool WaitingRoomEnabled = false,
    bool AllowStudentScreenshare = false);

public static class LiveKitRoomEndpoints
{
    public static IEndpointRouteBuilder MapLiveKitRoomEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/rooms").WithTags("livekit-rooms");

        group.MapGet("/config", (LiveKitOptions options) =>
            Results.Ok(new { enabled = options.IsConfigured }))
            .AllowAnonymous();

        group.MapPost("/open", async Task<IResult> (
            OpenRoomRequest request,
            ClaimsPrincipal principal,
            LiveKitOptions options,
            LiveKitRoomRepository repo,
            CancellationToken ct) =>
        {
            if (!options.IsConfigured)
                return MeetingsDisabled();

            var circle = await repo.GetCircleAsync(request.CircleId, ct);
            if (circle is null)
                return Results.NotFound(new { message = "الحلقة غير موجودة." });

            var (userId, teacherId) = ReadCaller(principal);
            if (!LiveKitRoomPolicy.IsHostUser(principal, circle.TeacherId, teacherId))
                return Results.Json(new { message = "لا تملك صلاحية فتح غرفة لهذه الحلقة." }, statusCode: StatusCodes.Status403Forbidden);

            var sessionId = await repo.FindActiveSessionIdAsync(circle.Id, request.SessionId, ct);
            var existing = await repo.GetOpenRoomByCircleAsync(circle.Id, ct);
            if (existing is not null)
            {
                if (sessionId.HasValue && existing.SessionId is null)
                    await repo.LinkSessionIfUnsetAsync(existing.Id, sessionId.Value, ct);
                var current = await repo.GetRoomByInviteCodeAsync(existing.InviteCode, ct) ?? existing;
                return Results.Ok(ToRoomDto(current));
            }

            var settings = LiveKitRoomPolicy.ResolveSettings(
                circle.IsChildren,
                request.AccessMode,
                request.WaitingRoomEnabled,
                request.AllowStudentScreenshare);

            var created = await repo.CreateRoomAsync(circle, sessionId, settings, userId, request.Title, ct);
            return Results.Created($"/api/v1/rooms/{created.InviteCode}", ToRoomDto(created));
        }).RequireAuthorization();

        group.MapGet("/circle/{circleId:guid}", async Task<IResult> (
            Guid circleId,
            LiveKitRoomRepository repo,
            CancellationToken ct) =>
        {
            var room = await repo.GetOpenRoomByCircleAsync(circleId, ct);
            return room is null ? Results.NotFound(new { message = "لا توجد غرفة مفتوحة حاليًا لهذه الحلقة." }) : Results.Ok(ToRoomDto(room));
        }).RequireAuthorization();

        group.MapGet("/{inviteCode}", async Task<IResult> (
            string inviteCode,
            ClaimsPrincipal principal,
            LiveKitOptions options,
            LiveKitRoomRepository repo,
            CancellationToken ct) =>
        {
            var room = await repo.GetRoomByInviteCodeAsync(inviteCode, ct);
            if (room is null)
                return Results.NotFound(new { message = "الغرفة غير موجودة." });

            var (userId, teacherId) = ReadCaller(principal);
            var isHost = LiveKitRoomPolicy.IsHostUser(principal, room.CircleTeacherId, teacherId);
            if (!isHost && room.AccessMode == "private" && !await repo.IsCircleMemberAsync(userId, room.CircleId, ct))
                return Results.Json(new { message = "هذه الغرفة خاصة بأعضاء الحلقة المسجلين فقط." }, statusCode: StatusCodes.Status403Forbidden);

            var participant = await repo.GetParticipantAsync(room.Id, userId, ct);
            return Results.Ok(new
            {
                enabled = options.IsConfigured,
                room = ToRoomDto(room),
                role = isHost ? "host" : "participant",
                admissionStatus = participant?.AdmissionStatus ?? (isHost || !room.WaitingRoomEnabled ? "admitted" : "pending"),
                mutedByHost = participant?.MutedByHost ?? false,
            });
        }).RequireAuthorization();

        group.MapPost("/{inviteCode}/token", async Task<IResult> (
            string inviteCode,
            ClaimsPrincipal principal,
            LiveKitOptions options,
            LiveKitTokenService tokens,
            LiveKitRoomRepository repo,
            CancellationToken ct) =>
        {
            if (!options.IsConfigured)
                return MeetingsDisabled();

            var room = await repo.GetRoomByInviteCodeAsync(inviteCode, ct);
            if (room is null)
                return Results.NotFound(new { message = "الغرفة غير موجودة." });
            if (room.Status != "open")
                return Results.Conflict(new { message = "تم إنهاء هذا الاجتماع." });

            var (userId, teacherId) = ReadCaller(principal);
            var displayName = principal.FindFirstValue("display_name") ?? principal.Identity?.Name ?? "مشارك";
            var isHost = LiveKitRoomPolicy.IsHostUser(principal, room.CircleTeacherId, teacherId);
            if (!isHost && room.AccessMode == "private" && !await repo.IsCircleMemberAsync(userId, room.CircleId, ct))
                return Results.Json(new { message = "هذه الغرفة خاصة بأعضاء الحلقة المسجلين فقط." }, statusCode: StatusCodes.Status403Forbidden);

            var role = isHost ? "host" : "participant";
            var participant = await repo.UpsertParticipantOnTokenRequestAsync(room.Id, userId, role, room.WaitingRoomEnabled, ct);

            if (participant.AdmissionStatus == "banned")
                return Results.Json(new { message = "تم حظرك من دخول هذه الغرفة." }, statusCode: StatusCodes.Status403Forbidden);
            if (participant.AdmissionStatus == "denied")
                return Results.Json(new { message = "تم رفض طلب انضمامك لهذه الغرفة." }, statusCode: StatusCodes.Status403Forbidden);

            if (participant.AdmissionStatus != "admitted")
            {
                return Results.Ok(new
                {
                    admitted = false,
                    admissionStatus = participant.AdmissionStatus,
                    role,
                    room = ToRoomDto(room),
                });
            }

            var sources = LiveKitRoomPolicy.ResolvePublishSources(isHost, room.IsChildren, room.AllowStudentScreenshare, participant.MutedByHost);
            var token = tokens.MintParticipantToken(room.RoomName, userId.ToString(), displayName, isHost, sources);

            return Results.Ok(new
            {
                admitted = true,
                admissionStatus = "admitted",
                token,
                url = options.Url,
                roomName = room.RoomName,
                role,
                onlyHostCanUnmute = room.IsChildren,
                allowStudentScreenshare = !room.IsChildren && room.AllowStudentScreenshare,
                mutedByHost = participant.MutedByHost,
                room = ToRoomDto(room),
            });
        }).RequireAuthorization();

        return app;
    }

    internal static (Guid UserId, Guid? TeacherId) ReadCaller(ClaimsPrincipal principal)
    {
        var userId = Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var uid) ? uid : Guid.Empty;
        var teacherId = Guid.TryParse(principal.FindFirstValue("teacher_id"), out var tid) ? tid : (Guid?)null;
        return (userId, teacherId);
    }

    internal static IResult MeetingsDisabled() => Results.Json(
        new { message = "خدمة الاجتماعات غير مفعّلة حاليًا لعدم اكتمال إعدادات LiveKit على الخادم." },
        statusCode: StatusCodes.Status503ServiceUnavailable);

    internal static object ToRoomDto(LiveKitRoomRecord r) => new
    {
        id = r.Id,
        roomName = r.RoomName,
        inviteCode = r.InviteCode,
        invitePath = $"/room/{r.InviteCode}",
        circleId = r.CircleId,
        circleName = r.CircleName,
        isChildren = r.IsChildren,
        sessionId = r.SessionId,
        title = r.Title,
        accessMode = r.AccessMode,
        waitingRoomEnabled = r.WaitingRoomEnabled,
        allowStudentScreenshare = r.AllowStudentScreenshare,
        onlyHostCanUnmute = r.IsChildren,
        status = r.Status,
        createdAt = r.CreatedAt,
    };
}
