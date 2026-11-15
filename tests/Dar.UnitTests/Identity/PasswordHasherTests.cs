using Dar.Modules.Identity.Infrastructure;

namespace Dar.UnitTests.Identity;

public sealed class PasswordHasherTests
{
    [Fact]
    public void HashAndVerify_RoundTrips()
    {
        var hash = PasswordHasher.Hash("a-strong-password-123");

        Assert.True(PasswordHasher.Verify("a-strong-password-123", hash));
        Assert.False(PasswordHasher.Verify("wrong-password", hash));
    }

    [Fact]
    public void Verify_RejectsOtpOnlySentinel()
    {
        Assert.False(PasswordHasher.Verify("anything", "otp-only"));
        Assert.False(PasswordHasher.Verify("anything", null));
    }

    [Fact]
    public void Hash_ProducesDifferentSalts()
    {
        var first = PasswordHasher.Hash("same-password");
        var second = PasswordHasher.Hash("same-password");

        Assert.NotEqual(first, second);
        Assert.True(PasswordHasher.Verify("same-password", first));
        Assert.True(PasswordHasher.Verify("same-password", second));
    }
}
