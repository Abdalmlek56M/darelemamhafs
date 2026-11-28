using System.Security.Claims;

namespace Dar.Modules.Meet.LiveKit;

public sealed record ModerateParticipantRequest(string Action, Guid TargetUserId);

public static class LiveKitHostControlEndpoints
{
    public static readonly HashSet<string> AllowedModerationActions = new(StringComparer.Ordinal)
    {
        "mute",
        "unmute",
        "remove",
        "ban",
        "admit",
        "deny",
    };

    public static IEndpointRouteBuilder MapLiveKitHostControlEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/rooms").WithTags("livekit-rooms");

        group.MapPost("/{inviteCode}/moderate", async Task<IResult> (
            string inviteCode,
            ModerateParticipantRequest request,
            ClaimsPrincipal principal,
            LiveKitRoomRepository repo,
            LiveKitServerClient serverClient,
            CancellationToken ct) =>
        {
            var action = request.Action?.Trim().ToLowerInvariant() ?? string.Empty;
            if (!AllowedModerationActions.Contains(action))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["action"] = ["إجراء الإشراف غير صحيح."] });

            var room = await repo.GetRoomByInviteCodeAsync(inviteCode, ct);
            if (room is null) return Results.NotFound(new { message = "الغرفة غير موجودة." });
            if (room.Status != "open") return Results.Conflict(new { message = "تم إنهاء هذا الاجتماع." });

            var (_, teacherId) = LiveKitRoomEndpoints.ReadCaller(principal);
            if (!LiveKitRoomPolicy.IsHostUser(principal, room.CircleTeacherId, teacherId))
                return Results.Json(new { message = "إدارة المشاركين متاحة للمضيف فقط." }, statusCode: StatusCodes.Status403Forbidden);

            var target = await repo.GetParticipantAsync(room.Id, request.TargetUserId, ct);
            if (target is null)
                return Results.NotFound(new { message = "المشارك غير موجود في الغرفة." });
            if (target.Role == "host")
                return Results.Conflict(new { message = "لا يمكن تطبيق هذا الإجراء على المضيف." });

            await repo.ModerateParticipantAsync(room.Id, request.TargetUserId, action, ct);

            var identity = request.TargetUserId.ToString();
            if (action == "mute")
                await serverClient.MuteParticipantAudioAsync(room.RoomName, identity, muted: true, ct);
            else if (action == "unmute")
                await serverClient.MuteParticipantAudioAsync(room.RoomName, identity, muted: false, ct);
            else if (action is "remove" or "ban" or "deny")
                await serverClient.RemoveParticipantAsync(room.RoomName, identity, ct);

            return Results.Ok(new { ok = true, action, targetUserId = request.TargetUserId });
        }).RequireAuthorization();

        group.MapPost("/{inviteCode}/end", async Task<IResult> (
            string inviteCode,
            ClaimsPrincipal principal,
            LiveKitRoomRepository repo,
            LiveKitServerClient serverClient,
            CancellationToken ct) =>
        {
            var room = await repo.GetRoomByInviteCodeAsync(inviteCode, ct);
            if (room is null) return Results.NotFound(new { message = "الغرفة غير موجودة." });

            var (_, teacherId) = LiveKitRoomEndpoints.ReadCaller(principal);
            if (!LiveKitRoomPolicy.IsHostUser(principal, room.CircleTeacherId, teacherId))
                return Results.Json(new { message = "إنهاء الاجتماع متاح للمضيف فقط." }, statusCode: StatusCodes.Status403Forbidden);

            await repo.EndRoomAsync(room.Id, ct);
            await serverClient.DeleteRoomAsync(room.RoomName, ct);
            return Results.Ok(new { ok = true });
        }).RequireAuthorization();

        return app;
    }
}
