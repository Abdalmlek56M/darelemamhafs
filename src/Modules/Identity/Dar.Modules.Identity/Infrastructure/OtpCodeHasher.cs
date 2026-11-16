using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Hosting;

namespace Dar.Modules.Identity.Infrastructure;

/// <summary>
/// HMAC-SHA256 of email + code with a server-side pepper.
/// Six-digit OTPs must never be stored in plaintext.
/// </summary>
public sealed class OtpCodeHasher
{
    private readonly byte[] _pepper;

    public OtpCodeHasher(IConfiguration configuration, IHostEnvironment environment, ILogger<OtpCodeHasher> logger)
    {
        var configured = configuration["Auth:Otp:Pepper"];
        if (!string.IsNullOrWhiteSpace(configured))
        {
            _pepper = Encoding.UTF8.GetBytes(configured);
            return;
        }

        if (!environment.IsDevelopment())
            throw new InvalidOperationException("Auth:Otp:Pepper must be configured outside Development. OTP login is disabled to avoid a process-local, non-shared key.");

        _pepper = RandomNumberGenerator.GetBytes(32);
        logger.LogWarning("Auth:Otp:Pepper is not configured; using a process-local key. OTPs will be invalid after restart.");
    }

    public string Hash(string email, string code)
    {
        var payload = Encoding.UTF8.GetBytes($"{Normalize(email)}:{code}");
        return Convert.ToBase64String(HMACSHA256.HashData(_pepper, payload));
    }

    public bool Verify(string email, string code, string storedHash)
    {
        try
        {
            var expected = Convert.FromBase64String(storedHash);
            var actual = HMACSHA256.HashData(_pepper, Encoding.UTF8.GetBytes($"{Normalize(email)}:{code}"));
            return CryptographicOperations.FixedTimeEquals(expected, actual);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static string Normalize(string email) => email.Trim().ToLowerInvariant();
}
