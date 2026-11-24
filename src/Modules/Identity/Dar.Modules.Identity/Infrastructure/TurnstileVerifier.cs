using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace Dar.Modules.Identity.Infrastructure;

public enum TurnstileCheck
{
    Disabled,
    Allowed,
    Rejected,
    UnavailableAllowed,
    UnavailableRejected,
}

/// <summary>
/// P1-1 phase 2: Cloudflare Turnstile server-side verification.
/// The secret is read only from configuration/environment and is never logged.
/// </summary>
public sealed class TurnstileVerifier(
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    ILogger<TurnstileVerifier> logger)
{
    private static readonly ConcurrentDictionary<string, DateTimeOffset> ConsumedTokens = new();
    private static readonly TimeSpan ConsumedTokenTtl = TimeSpan.FromMinutes(10);
    private static readonly object CleanupGate = new();

    public bool Enabled => configuration.GetValue<bool>("Auth:Turnstile:Enabled");
    public string? SiteKey => configuration["Auth:Turnstile:SiteKey"];

    public async Task<TurnstileCheck> VerifyAsync(string? token, string? remoteIp, CancellationToken ct)
    {
        if (!Enabled) return TurnstileCheck.Disabled;
        if (string.IsNullOrWhiteSpace(token) || token.Length > 4096) return TurnstileCheck.Rejected;

        var tokenHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
        CleanupExpiredTokens();
        if (ConsumedTokens.ContainsKey(tokenHash)) return TurnstileCheck.Rejected;

        var verifyUrl = configuration["Auth:Turnstile:VerifyUrl"]
            ?? "https://challenges.cloudflare.com/turnstile/v0/siteverify";
        var secret = configuration["Auth:Turnstile:SecretKey"];
        if (string.IsNullOrWhiteSpace(secret))
        {
            logger.LogCritical("Turnstile is enabled but Auth:Turnstile:SecretKey is missing.");
            return TurnstileCheck.UnavailableRejected;
        }

        var timeoutMs = configuration.GetValue<int?>("Auth:Turnstile:TimeoutMs") ?? 5000;
        var failOpen = configuration.GetValue<bool?>("Auth:Turnstile:FailOpen") ?? true;
        var expectedHostname = configuration["Auth:Turnstile:ExpectedHostname"] ?? "dar-elemam-hafs.rigxhardware.com";
        var expectedAction = configuration["Auth:Turnstile:ExpectedAction"] ?? "login";

        var fields = new Dictionary<string, string>
        {
            ["secret"] = secret,
            ["response"] = token,
        };
        if (!string.IsNullOrWhiteSpace(remoteIp)) fields["remoteip"] = remoteIp;

        try
        {
            var client = httpClientFactory.CreateClient("turnstile");
            using var request = new HttpRequestMessage(HttpMethod.Post, verifyUrl)
            {
                Content = new FormUrlEncodedContent(fields)
            };
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromMilliseconds(Math.Clamp(timeoutMs, 500, 15000)));
            using var response = await client.SendAsync(request, timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Turnstile siteverify returned HTTP {Status}.", (int)response.StatusCode);
                return failOpen ? TurnstileCheck.UnavailableAllowed : TurnstileCheck.UnavailableRejected;
            }

            await using var body = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var document = await JsonDocument.ParseAsync(body, cancellationToken: timeout.Token);
            var root = document.RootElement;
            var success = root.TryGetProperty("success", out var successElement)
                && successElement.ValueKind == JsonValueKind.True;
            if (!success)
            {
                if (root.TryGetProperty("error-codes", out var errors))
                    logger.LogWarning("Turnstile rejected a token: {Codes}", errors.ToString());
                return TurnstileCheck.Rejected;
            }

            var hostname = root.TryGetProperty("hostname", out var hostnameElement) ? hostnameElement.GetString() : null;
            var action = root.TryGetProperty("action", out var actionElement) ? actionElement.GetString() : null;
            if (!string.Equals(hostname, expectedHostname, StringComparison.OrdinalIgnoreCase)
                || !string.Equals(action, expectedAction, StringComparison.Ordinal))
            {
                logger.LogWarning("Turnstile response hostname/action mismatch (hostname={Hostname}, action={Action}).", hostname, action);
                return TurnstileCheck.Rejected;
            }

            // Cloudflare tokens are single-use; this local cache also rejects replays deterministically.
            return ConsumedTokens.TryAdd(tokenHash, DateTimeOffset.UtcNow.Add(ConsumedTokenTtl))
                ? TurnstileCheck.Allowed
                : TurnstileCheck.Rejected;
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning("Turnstile siteverify timed out.");
            return failOpen ? TurnstileCheck.UnavailableAllowed : TurnstileCheck.UnavailableRejected;
        }
        catch (HttpRequestException exception)
        {
            logger.LogWarning(exception, "Turnstile siteverify is unreachable.");
            return failOpen ? TurnstileCheck.UnavailableAllowed : TurnstileCheck.UnavailableRejected;
        }
        catch (System.Text.Json.JsonException)
        {
            // A 200 response with a malformed body is an upstream failure, not a valid rejection.
            // Never log the raw response: it may contain attacker-controlled content.
            logger.LogWarning("Turnstile siteverify returned an invalid JSON payload.");
            return failOpen ? TurnstileCheck.UnavailableAllowed : TurnstileCheck.UnavailableRejected;
        }
    }

    private static void CleanupExpiredTokens()
    {
        if (ConsumedTokens.Count < 512) return;
        lock (CleanupGate)
        {
            var now = DateTimeOffset.UtcNow;
            foreach (var pair in ConsumedTokens)
            {
                if (pair.Value <= now) ConsumedTokens.TryRemove(pair.Key, out _);
            }
        }
    }
}
