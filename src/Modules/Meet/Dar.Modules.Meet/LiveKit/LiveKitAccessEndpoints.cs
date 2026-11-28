using System.Security.Claims;

namespace Dar.Modules.Meet.LiveKit;

public sealed record UpdateRoomAccessRequest(
    string? AccessMode,
    bool WaitingRoomEnabled,
    bool AllowStudentScreenshare);

public static class LiveKitAccessEndpoints
{
    public static IEndpointRouteBuilder MapLiveKitAccessEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/rooms").WithTags("livekit-rooms");

        group.MapGet("/{inviteCode}/participants", async Task<IResult> (
            string inviteCode,
            ClaimsPrincipal principal,
            LiveKitRoomRepository repo,
            CancellationToken ct) =>
        {
            var room = await repo.GetRoomByInviteCodeAsync(inviteCode, ct);
            if (room is null) return Results.NotFound(new { message = "الغرفة غير موجودة." });

            var (_, teacherId) = LiveKitRoomEndpoints.ReadCaller(principal);
            if (!LiveKitRoomPolicy.IsHostUser(principal, room.CircleTeacherId, teacherId))
                return Results.Json(new { message = "عرض قائمة المشاركين متاح للمضيف فقط." }, statusCode: StatusCodes.Status403Forbidden);

            var all = await repo.ListParticipantsAsync(room.Id, ct);
            return Results.Ok(new
            {
                participants = all.Select(ToParticipantDto),
            });
        }).RequireAuthorization();

        group.MapPatch("/{inviteCode}/access", async Task<IResult> (
            string inviteCode,
            UpdateRoomAccessRequest request,
            ClaimsPrincipal principal,
            LiveKitRoomRepository repo,
            CancellationToken ct) =>
        {
            var room = await repo.GetRoomByInviteCodeAsync(inviteCode, ct);
            if (room is null) return Results.NotFound(new { message = "الغرفة غير موجودة." });

            var (_, teacherId) = LiveKitRoomEndpoints.ReadCaller(principal);
            if (!LiveKitRoomPolicy.IsHostUser(principal, room.CircleTeacherId, teacherId))
                return Results.Json(new { message = "تعديل إعدادات الدخول متاح للمضيف فقط." }, statusCode: StatusCodes.Status403Forbidden);

            var settings = LiveKitRoomPolicy.ResolveSettings(
                room.IsChildren,
                request.AccessMode,
                request.WaitingRoomEnabled,
                request.AllowStudentScreenshare);

            var updated = await repo.UpdateAccessSettingsAsync(room.Id, room.InviteCode, settings, ct);
            return Results.Ok(LiveKitRoomEndpoints.ToRoomDto(updated ?? room));
        }).RequireAuthorization();

        return app;
    }

    internal static object ToParticipantDto(ParticipantStateRecord p) => new
    {
        userId = p.UserId,
        username = p.Username,
        displayName = p.DisplayName,
        role = p.Role,
        admissionStatus = p.AdmissionStatus,
        mutedByHost = p.MutedByHost,
        firstJoinedAt = p.FirstJoinedAt,
        lastJoinedAt = p.LastJoinedAt,
        lastLeftAt = p.LastLeftAt,
        attendedSeconds = p.AttendedSeconds,
        attendedMinutes = (int)Math.Round(p.AttendedSeconds / 60.0, MidpointRounding.AwayFromZero),
        isConnected = p.IsConnected,
    };
}
