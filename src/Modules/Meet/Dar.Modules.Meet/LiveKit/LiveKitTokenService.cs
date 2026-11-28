using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Dar.Modules.Meet.LiveKit;

/// <summary>
/// Mints short-lived HS256 JWT tokens for LiveKit rooms and server RoomService API calls.
/// Zero external JWT dependencies; uses the exact LiveKit video grant schema.
/// </summary>
public sealed class LiveKitTokenService(LiveKitOptions options)
{
    public const int DefaultParticipantTtlSeconds = 3600;
    public const int DefaultServerTtlSeconds = 120;

    public string MintParticipantToken(
        string roomName,
        string identity,
        string displayName,
        bool isHost,
        string[] publishSources,
        DateTimeOffset? now = null)
    {
        EnsureConfigured();
        var issuedAt = (now ?? DateTimeOffset.UtcNow).ToUnixTimeSeconds();
        var payload = new
        {
            iss = options.ApiKey,
            sub = identity,
            name = displayName,
            nbf = issuedAt - 10,
            exp = issuedAt + DefaultParticipantTtlSeconds,
            metadata = JsonSerializer.Serialize(new { role = isHost ? "host" : "participant" }),
            video = new
            {
                roomJoin = true,
                room = roomName,
                roomAdmin = isHost,
                canPublish = publishSources.Length > 0,
                canPublishSources = publishSources,
                canSubscribe = true,
                canPublishData = true,
            },
        };
        return SignJwt(payload);
    }

    public string MintServerAdminToken(string roomName, DateTimeOffset? now = null)
    {
        EnsureConfigured();
        var issuedAt = (now ?? DateTimeOffset.UtcNow).ToUnixTimeSeconds();
        var payload = new
        {
            iss = options.ApiKey,
            sub = "dar-server",
            nbf = issuedAt - 10,
            exp = issuedAt + DefaultServerTtlSeconds,
            video = new
            {
                roomAdmin = true,
                roomCreate = true,
                room = roomName,
            },
        };
        return SignJwt(payload);
    }

    private void EnsureConfigured()
    {
        if (!options.IsConfigured)
            throw new InvalidOperationException("LiveKit is not configured.");
    }

    private string SignJwt(object payload)
    {
        var headerJson = JsonSerializer.Serialize(new { alg = "HS256", typ = "JWT" });
        var payloadJson = JsonSerializer.Serialize(payload);
        var signingInput = $"{Base64UrlEncode(Encoding.UTF8.GetBytes(headerJson))}.{Base64UrlEncode(Encoding.UTF8.GetBytes(payloadJson))}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(options.ApiSecret));
        var signature = hmac.ComputeHash(Encoding.UTF8.GetBytes(signingInput));
        return $"{signingInput}.{Base64UrlEncode(signature)}";
    }

    private static string Base64UrlEncode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
