using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;

namespace Dar.Modules.Meet.Infrastructure;

/// <summary>
/// AES-256-GCM for the stored Google refresh token and HMAC-signed OAuth state.
/// The state is self-contained because the legacy admin cookie is SameSite=Strict and
/// is therefore absent on the cross-site redirect coming back from Google (ADR-0006).
/// </summary>
public sealed class MeetCrypto
{
    private const int NonceSize = 12;
    private const int TagSize = 16;
    private static readonly byte[] StateDomain = Encoding.UTF8.GetBytes("meet-oauth-state:v1:");

    private readonly byte[]? _key;
    private readonly TimeSpan _stateLifetime;

    public MeetCrypto(IOptions<MeetOptions> options)
    {
        _key = MeetOptions.IsValidKey(options.Value.EncryptionKey)
            ? Convert.FromBase64String(options.Value.EncryptionKey)
            : null;
        var minutes = options.Value.StateLifetimeMinutes;
        _stateLifetime = TimeSpan.FromMinutes(minutes is >= 1 and <= 120 ? minutes : 10);
    }

    public bool IsReady => _key is not null;

    public string Encrypt(string plaintext)
    {
        var key = RequireKey();
        var plain = Encoding.UTF8.GetBytes(plaintext);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var cipher = new byte[plain.Length];
        var tag = new byte[TagSize];
        using (var aes = new AesGcm(key, TagSize))
            aes.Encrypt(nonce, plain, cipher, tag);

        var payload = new byte[NonceSize + TagSize + cipher.Length];
        nonce.CopyTo(payload, 0);
        tag.CopyTo(payload, NonceSize);
        cipher.CopyTo(payload, NonceSize + TagSize);
        return WebEncoders.Base64UrlEncode(payload);
    }

    public string Decrypt(string payload)
    {
        var key = RequireKey();
        byte[] raw;
        try
        {
            raw = WebEncoders.Base64UrlDecode(payload);
        }
        catch (FormatException)
        {
            throw new InvalidOperationException("Meet token payload is not valid base64.");
        }

        if (raw.Length <= NonceSize + TagSize)
            throw new InvalidOperationException("Meet token payload is truncated.");

        var nonce = raw.AsSpan(0, NonceSize);
        var tag = raw.AsSpan(NonceSize, TagSize);
        var cipher = raw.AsSpan(NonceSize + TagSize);
        var plain = new byte[cipher.Length];
        using (var aes = new AesGcm(key, TagSize))
            aes.Decrypt(nonce, cipher, tag, plain);
        return Encoding.UTF8.GetString(plain);
    }

    /// <summary>Returns false for legacy plaintext or corrupt ciphertext instead of throwing.</summary>
    public bool TryDecrypt(string? payload, out string plaintext)
    {
        plaintext = string.Empty;
        if (string.IsNullOrWhiteSpace(payload)) return false;
        try
        {
            plaintext = Decrypt(payload);
            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }

    public string CreateState(Guid userId, DateTimeOffset now)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(new StatePayload(userId, now.Add(_stateLifetime).ToUnixTimeSeconds(), Guid.NewGuid()));
        var mac = Sign(payload);
        return WebEncoders.Base64UrlEncode(payload) + "." + WebEncoders.Base64UrlEncode(mac);
    }

    public bool TryReadState(string? token, DateTimeOffset now, out Guid userId, out Guid stateNonce, out string? error)
    {
        userId = Guid.Empty;
        stateNonce = Guid.Empty;
        error = null;
        if (string.IsNullOrWhiteSpace(token) || !IsReady)
        {
            error = "حالة الربط غير صالحة أو مهلة الربط انتهت. أعد المحاولة من جديد.";
            return false;
        }

        var parts = token.Split('.');
        if (parts.Length != 2)
        {
            error = "حالة الربط غير صالحة. أعد المحاولة من جديد.";
            return false;
        }

        byte[] payload;
        byte[] mac;
        try
        {
            payload = WebEncoders.Base64UrlDecode(parts[0]);
            mac = WebEncoders.Base64UrlDecode(parts[1]);
        }
        catch (FormatException)
        {
            error = "حالة الربط غير صالحة. أعد المحاولة من جديد.";
            return false;
        }

        if (!CryptographicOperations.FixedTimeEquals(mac, Sign(payload)))
        {
            error = "حالة الربط غير صالحة. أعد المحاولة من جديد.";
            return false;
        }

        StatePayload? state;
        try
        {
            state = JsonSerializer.Deserialize<StatePayload>(payload);
        }
        catch (JsonException)
        {
            state = null;
        }

        if (state is null || state.U == Guid.Empty || state.N == Guid.Empty)
        {
            error = "حالة الربط غير صالحة. أعد المحاولة من جديد.";
            return false;
        }

        if (DateTimeOffset.FromUnixTimeSeconds(state.E) < now)
        {
            error = "انتهت مهلة ربط التقويم. اضغط «ربط Google» مرة أخرى.";
            return false;
        }

        userId = state.U;
        stateNonce = state.N;
        return true;
    }

    private byte[] Sign(byte[] payload)
    {
        var key = RequireKey();
        using var hmac = new HMACSHA256(key);
        var message = new byte[StateDomain.Length + payload.Length];
        StateDomain.CopyTo(message, 0);
        payload.CopyTo(message, StateDomain.Length);
        return hmac.ComputeHash(message);
    }

    private byte[] RequireKey() =>
        _key ?? throw new InvalidOperationException(
            "Meet:EncryptionKey is not configured. Recording endpoints stay disabled until a 32-byte base64 key is provided.");

    /// <summary>N is a one-time nonce; the callback consumes it in the database (FINAL 1.15).</summary>
    private sealed record StatePayload(Guid U, long E, Guid N);
}
