using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace Dar.Modules.Meet.LiveKit;

/// <summary>
/// Server-to-server LiveKit RoomService Twirp client for host moderation and room teardown.
/// Never logs tokens, keys, or secrets.
/// </summary>
public sealed class LiveKitServerClient(
    IHttpClientFactory httpClientFactory,
    LiveKitOptions options,
    LiveKitTokenService tokens,
    ILogger<LiveKitServerClient> logger)
{
    public Task MuteParticipantAudioAsync(string roomName, string identity, bool muted, CancellationToken ct) =>
        PostTwirpAsync("UpdateParticipant", roomName, new
        {
            room = roomName,
            identity,
            permission = new
            {
                canSubscribe = true,
                canPublish = !muted,
                canPublishData = true,
            },
        }, ct);

    public Task RemoveParticipantAsync(string roomName, string identity, CancellationToken ct) =>
        PostTwirpAsync("RemoveParticipant", roomName, new
        {
            room = roomName,
            identity,
        }, ct);

    public Task DeleteRoomAsync(string roomName, CancellationToken ct) =>
        PostTwirpAsync("DeleteRoom", roomName, new
        {
            room = roomName,
        }, ct);

    private async Task PostTwirpAsync(string method, string roomName, object body, CancellationToken ct)
    {
        if (!options.IsConfigured) return;
        var baseUri = options.ResolveHttpBaseUri();
        if (baseUri is null) return;

        try
        {
            var client = httpClientFactory.CreateClient("livekit-server");
            using var request = new HttpRequestMessage(
                HttpMethod.Post,
                new Uri(baseUri, $"/twirp/livekit.RoomService/{method}"));
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokens.MintServerAdminToken(roomName));
            request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
            using var response = await client.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogDebug("LiveKit RoomService/{Method} returned {StatusCode} for room {RoomName}.", method, (int)response.StatusCode, roomName);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning("LiveKit RoomService/{Method} call failed for room {RoomName}: {Message}", method, roomName, ex.Message);
        }
    }
}
