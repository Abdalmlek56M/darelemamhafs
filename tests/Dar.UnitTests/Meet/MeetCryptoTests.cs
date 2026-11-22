using System.Security.Cryptography;
using Dar.Modules.Meet.Infrastructure;
using Microsoft.Extensions.Options;

namespace Dar.UnitTests.Meet;

/// <summary>
/// ADR-0006/0007: the Google refresh token is AES-256-GCM encrypted and the OAuth state
/// is HMAC-signed, self-contained and short lived. These are the security-critical bits.
/// </summary>
public class MeetCryptoTests
{
    private static MeetCrypto Crypto(string? key = null) =>
        new(Options.Create(new MeetOptions
        {
            EncryptionKey = key ?? Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
            StateLifetimeMinutes = 10
        }));

    [Fact]
    public void EncryptThenDecryptRoundTrips()
    {
        var crypto = Crypto();
        const string refreshToken = "1//0g-refresh-token-value";

        var encrypted = crypto.Encrypt(refreshToken);

        Assert.NotEqual(refreshToken, encrypted);
        Assert.Equal(refreshToken, crypto.Decrypt(encrypted));
    }

    [Fact]
    public void SameValueEncryptsDifferentlyEachTime()
    {
        var crypto = Crypto();
        Assert.NotEqual(crypto.Encrypt("same"), crypto.Encrypt("same"));
    }

    [Fact]
    public void DecryptWithAnotherKeyFails()
    {
        var encrypted = Crypto().Encrypt("refresh-token");
        Assert.ThrowsAny<CryptographicException>(() => Crypto().Decrypt(encrypted));
    }

    [Fact]
    public void StateRoundTripsForTheSameUser()
    {
        var crypto = Crypto();
        var userId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;

        var state = crypto.CreateState(userId, now);

        Assert.True(crypto.TryReadState(state, now.AddMinutes(1), out var parsed, out var error));
        Assert.Null(error);
        Assert.Equal(userId, parsed);
    }

    [Fact]
    public void TamperedStateIsRejected()
    {
        var crypto = Crypto();
        var state = crypto.CreateState(Guid.NewGuid(), DateTimeOffset.UtcNow);
        var tampered = state[..^1] + (state[^1] == 'A' ? 'B' : 'A');

        Assert.False(crypto.TryReadState(tampered, DateTimeOffset.UtcNow, out _, out var error));
        Assert.NotNull(error);
    }

    [Fact]
    public void ExpiredStateIsRejected()
    {
        var crypto = Crypto();
        var now = DateTimeOffset.UtcNow;
        var state = crypto.CreateState(Guid.NewGuid(), now);

        Assert.False(crypto.TryReadState(state, now.AddMinutes(30), out _, out var error));
        Assert.Contains("مهلة", error);
    }

    [Fact]
    public void StateSignedByAnotherKeyIsRejected()
    {
        var state = Crypto().CreateState(Guid.NewGuid(), DateTimeOffset.UtcNow);
        Assert.False(Crypto().TryReadState(state, DateTimeOffset.UtcNow, out _, out _));
    }

    [Fact]
    public void MissingOrShortKeyLeavesCryptoNotReady()
    {
        Assert.False(Crypto("").IsReady);
        Assert.False(Crypto(Convert.ToBase64String(new byte[16])).IsReady);
        Assert.Throws<InvalidOperationException>(() => Crypto("").Encrypt("x"));
    }

    [Fact]
    public void MissingConfiguredKeysAreReportedExplicitly()
    {
        var options = new MeetOptions();

        var missing = options.MissingPrerequisites();

        Assert.Contains("Meet:Google:ClientId", missing);
        Assert.Contains("Meet:Google:ClientSecret", missing);
        Assert.Contains("Meet:Google:RedirectUri", missing);
        Assert.False(options.IsConfigured);
    }
}
