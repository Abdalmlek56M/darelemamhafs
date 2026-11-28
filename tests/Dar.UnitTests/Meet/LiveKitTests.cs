using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Dar.Modules.Meet.LiveKit;
using Xunit;

namespace Dar.UnitTests.Meet;

public sealed class LiveKitTests
{
    [Fact]
    public void LiveKitOptions_reports_exact_missing_env_variable_names()
    {
        var opts = new LiveKitOptions("wss://example.livekit.cloud", "", null);
        var missing = opts.MissingVariables();
        Assert.False(opts.IsConfigured);
        Assert.Equal(["LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"], missing);
    }

    [Fact]
    public void LiveKitRoomPolicy_enforces_children_circle_safe_defaults()
    {
        var settings = LiveKitRoomPolicy.ResolveSettings(
            isChildrenCircle: true,
            requestedAccessMode: "public",
            requestedWaitingRoom: false,
            requestedAllowStudentScreenshare: true);

        Assert.Equal("private", settings.AccessMode);
        Assert.True(settings.WaitingRoomEnabled);
        Assert.False(settings.AllowStudentScreenshare);
        Assert.True(settings.OnlyHostCanUnmute);
    }

    [Fact]
    public void LiveKitTokenService_mints_1h_jwt_with_role_permissions()
    {
        var opts = new LiveKitOptions("wss://lk.example.test", "devkey", "devsecret-at-least-32-characters-long");
        var svc = new LiveKitTokenService(opts);
        var fixedNow = new DateTimeOffset(2026, 11, 28, 10, 0, 0, TimeSpan.Zero);

        var hostToken = svc.MintParticipantToken("dar-123", "u-1", "أ. فاطمة", isHost: true, ["camera", "microphone", "screen_share"], fixedNow);
        var childStudentToken = svc.MintParticipantToken("dar-123", "u-2", "طالبة", isHost: false, ["microphone"], fixedNow);

        var hostPayload = DecodeJwtPayload(hostToken);
        Assert.Equal("devkey", hostPayload.GetProperty("iss").GetString());
        Assert.Equal(fixedNow.ToUnixTimeSeconds() + 3600, hostPayload.GetProperty("exp").GetInt64());
        Assert.True(hostPayload.GetProperty("video").GetProperty("roomAdmin").GetBoolean());

        var studentPayload = DecodeJwtPayload(childStudentToken);
        Assert.False(studentPayload.GetProperty("video").GetProperty("roomAdmin").GetBoolean());
        var sources = studentPayload.GetProperty("video").GetProperty("canPublishSources").EnumerateArray().Select(e => e.GetString()).ToArray();
        Assert.Equal(["microphone"], sources);
    }

    [Fact]
    public void IsHostUser_grants_host_to_assigned_teacher_and_supervisor_only()
    {
        var teacherId = Guid.NewGuid();
        var teacherPrincipal = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim("permission", "teacher.portal"),
            new Claim("teacher_id", teacherId.ToString()),
        ], "test"));
        var studentPrincipal = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim("permission", "account.password.self"),
        ], "test"));

        Assert.True(LiveKitRoomPolicy.IsHostUser(teacherPrincipal, teacherId, teacherId));
        Assert.False(LiveKitRoomPolicy.IsHostUser(teacherPrincipal, Guid.NewGuid(), teacherId));
        Assert.False(LiveKitRoomPolicy.IsHostUser(studentPrincipal, teacherId, null));
    }

    [Fact]
    public void ResolveSettings_allows_public_link_and_screenshare_for_non_children_circles_when_requested()
    {
        var settings = LiveKitRoomPolicy.ResolveSettings(
            isChildrenCircle: false,
            requestedAccessMode: "public",
            requestedWaitingRoom: true,
            requestedAllowStudentScreenshare: true);

        Assert.Equal("public", settings.AccessMode);
        Assert.True(settings.WaitingRoomEnabled);
        Assert.True(settings.AllowStudentScreenshare);
        Assert.False(settings.OnlyHostCanUnmute);
    }

    [Fact]
    public void ResolvePublishSources_blocks_all_publishing_when_muted_by_host()
    {
        var mutedSources = LiveKitRoomPolicy.ResolvePublishSources(
            isHost: false,
            isChildrenCircle: false,
            allowStudentScreenshare: true,
            mutedByHost: true);

        Assert.Empty(mutedSources);
    }

    [Fact]
    public void AllowedModerationActions_includes_all_host_controls()
    {
        Assert.Contains("mute", LiveKitHostControlEndpoints.AllowedModerationActions);
        Assert.Contains("unmute", LiveKitHostControlEndpoints.AllowedModerationActions);
        Assert.Contains("remove", LiveKitHostControlEndpoints.AllowedModerationActions);
        Assert.Contains("ban", LiveKitHostControlEndpoints.AllowedModerationActions);
        Assert.Contains("admit", LiveKitHostControlEndpoints.AllowedModerationActions);
        Assert.Contains("deny", LiveKitHostControlEndpoints.AllowedModerationActions);
        Assert.DoesNotContain("promote", LiveKitHostControlEndpoints.AllowedModerationActions);
    }

    private static JsonElement DecodeJwtPayload(string jwt)
    {
        var parts = jwt.Split('.');
        Assert.Equal(3, parts.Length);
        var base64 = parts[1].Replace('-', '+').Replace('_', '/');
        base64 = base64.PadRight(base64.Length + (4 - base64.Length % 4) % 4, '=');
        var json = Encoding.UTF8.GetString(Convert.FromBase64String(base64));
        return JsonDocument.Parse(json).RootElement;
    }
}
