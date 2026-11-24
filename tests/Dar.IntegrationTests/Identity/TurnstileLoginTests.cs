using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dar.Common.Domain;
using Dar.Modules.Identity.Features.PasswordSignIn;
using Dar.Modules.Identity.Infrastructure;
using Dar.Modules.Identity.Persistence;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

namespace Dar.IntegrationTests.Identity;

/// <summary>
/// P1-1 phase 2 tests: Turnstile is verified server-side with hostname+action checks,
/// one-time tokens, and lockout-integrated behavior. Uses a local mock siteverify endpoint;
/// no Cloudflare key is stored in the repository.
/// </summary>
public sealed class TurnstileLoginTests
{
    private const string EnvName = "DAR_TEST_DATABASE";
    private const string Password = "TestPass123!";
    private const string ExpectedHostname = "dar-elemam-hafs.rigxhardware.com";
    private const string ExpectedAction = "login";
    private static string? ConnectionString => Environment.GetEnvironmentVariable(EnvName);

    [Fact]
    public async Task DisabledConfigEndpoint_ReturnsEnabledFalse()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        using var client = Client(ConnectionString!, new Dictionary<string, string?>());
        var response = await client.GetAsync("/api/v1/auth/config");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.False(json.RootElement.GetProperty("enabled").GetBoolean());
        Assert.Equal(JsonValueKind.Null, json.RootElement.GetProperty("siteKey").ValueKind);
    }

    [Fact]
    public async Task MissingToken_IsRejected_AndDoesNotIncrementLockout()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        var user = await SeedUserAsync(ConnectionString!, "ts_missing");
        await using var stub = await SiteverifyStub.StartAsync();
        var handler = Handler(ConnectionString!, stub, failOpen: true);
        var exception = await FailureAsync(handler, user.Username, Password, token: null);
        Assert.NotNull(exception);
        Assert.Equal(400, exception!.StatusCode);
        Assert.Null(await ReadAttemptAsync(ConnectionString!, user.Username));
    }

    [Fact]
    public async Task WrongHostnameOrAction_IsRejected_WithoutLockoutIncrement()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        var user = await SeedUserAsync(ConnectionString!, "ts_host");
        await using var stub = await SiteverifyStub.StartAsync();
        var handler = Handler(ConnectionString!, stub, failOpen: true);
        foreach (var token in new[] { "bad-host-" + Guid.NewGuid(), "bad-action-" + Guid.NewGuid() })
        {
            var exception = await FailureAsync(handler, user.Username, Password, token);
            Assert.NotNull(exception);
            Assert.Equal(400, exception!.StatusCode);
        }
        Assert.Null(await ReadAttemptAsync(ConnectionString!, user.Username));
    }

    [Fact]
    public async Task ValidToken_AllowsPasswordCheck_AndRejectsReusedToken()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        var user = await SeedUserAsync(ConnectionString!, "ts_reuse");
        await using var stub = await SiteverifyStub.StartAsync();
        var handler = Handler(ConnectionString!, stub, failOpen: true);
        var token = "ok-reuse-" + Guid.NewGuid();

        var first = await FailureAsync(handler, user.Username, "wrong-password", token);
        Assert.NotNull(first);
        Assert.Equal(401, first!.StatusCode);
        var row = await ReadAttemptAsync(ConnectionString!, user.Username);
        Assert.NotNull(row);
        Assert.Equal(1, row!.Value.Attempts);

        var reused = await FailureAsync(handler, user.Username, "wrong-password", token);
        Assert.NotNull(reused);
        Assert.Equal(400, reused!.StatusCode);
        var afterReuse = await ReadAttemptAsync(ConnectionString!, user.Username);
        Assert.Equal(1, afterReuse!.Value.Attempts);
    }

    [Fact]
    public async Task SiteverifyUnavailable_FailOpenAllowsPasswordPath_AndFailClosedRejects()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        var user = await SeedUserAsync(ConnectionString!, "ts_outage");
        await using var stub = await SiteverifyStub.StartAsync();

        var openHandler = Handler(ConnectionString!, stub, failOpen: true, forceStatusCode: 500);
        var openFailure = await FailureAsync(openHandler, user.Username, "wrong-password", "ok-" + Guid.NewGuid());
        Assert.NotNull(openFailure);
        Assert.Equal(401, openFailure!.StatusCode);
        Assert.NotNull(await ReadAttemptAsync(ConnectionString!, user.Username));

        var closedHandler = Handler(ConnectionString!, stub, failOpen: false, forceStatusCode: 500);
        var closedFailure = await FailureAsync(closedHandler, user.Username, "wrong-password", "ok-" + Guid.NewGuid());
        Assert.NotNull(closedFailure);
        Assert.Equal(503, closedFailure!.StatusCode);
    }

    [Fact]
    public async Task LockedAccount_Returns429_BeforeTurnstileCheck()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        var user = await SeedUserAsync(ConnectionString!, "ts_locked");
        await using (var connection = new NpgsqlConnection(ConnectionString))
        {
            await connection.OpenAsync();
            await using var cmd = new NpgsqlCommand("INSERT INTO login_attempts(username, failed_attempts, locked_until, last_failed_at, updated_at) VALUES(lower(@u), 5, now() + INTERVAL '5 minutes', now(), now());", connection);
            cmd.Parameters.AddWithValue("u", user.Username);
            await cmd.ExecuteNonQueryAsync();
        }
        await using var stub = await SiteverifyStub.StartAsync();
        var handler = Handler(ConnectionString!, stub, failOpen: true);
        var exception = await FailureAsync(handler, user.Username, Password, token: null);
        Assert.NotNull(exception);
        Assert.Equal(429, exception!.StatusCode);
    }

    private static PasswordSignInHandler Handler(string connectionString, SiteverifyStub stub, bool failOpen, int? forceStatusCode = null)
    {
        var siteKey = "site-" + Guid.NewGuid().ToString("N");
        var secretKey = "secret-" + Guid.NewGuid().ToString("N");
        var settings = new Dictionary<string, string?>
        {
            ["Auth:Turnstile:Enabled"] = "true",
            ["Auth:Turnstile:SiteKey"] = siteKey,
            ["Auth:Turnstile:SecretKey"] = secretKey,
            ["Auth:Turnstile:VerifyUrl"] = stub.Url,
            ["Auth:Turnstile:FailOpen"] = failOpen ? "true" : "false",
            ["Auth:Turnstile:TimeoutMs"] = "2000",
            ["Auth:Turnstile:ExpectedHostname"] = ExpectedHostname,
            ["Auth:Turnstile:ExpectedAction"] = ExpectedAction,
        };
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var client = new HttpClient();
        var verifier = new TurnstileVerifier(new SingleHttpClientFactory(client), configuration, NullLogger<TurnstileVerifier>.Instance);
        if (forceStatusCode is { } statusCode)
            stub.ForceStatusCode = statusCode;
        return new PasswordSignInHandler(new IdentityRepository(NpgsqlDataSource.Create(connectionString)), verifier);
    }

    private static async Task<AppException?> FailureAsync(PasswordSignInHandler handler, string username, string password, string? token)
    {
        try
        {
            await handler.HandleAsync(new PasswordSignInRequest(username, password, TurnstileToken: token), new DefaultHttpContext(), CancellationToken.None);
            return null;
        }
        catch (AppException exception)
        {
            return exception;
        }
    }

    private static HttpClient Client(string connectionString, Dictionary<string, string?> extra)
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                var values = new Dictionary<string, string?>
                {
                    ["ConnectionStrings:Default"] = connectionString,
                    ["Auth:Otp:Pepper"] = "integration-test-pepper-1234567890"
                };
                foreach (var pair in extra) values[pair.Key] = pair.Value;
                config.AddInMemoryCollection(values);
            });
        });
        return factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = true });
    }

    private sealed record SeedUser(string Username);

    private static async Task<SeedUser> SeedUserAsync(string connectionString, string prefix)
    {
        var id = Guid.NewGuid();
        var username = prefix + "_" + Guid.NewGuid().ToString("N")[..8];
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("""
            INSERT INTO app_users(id, username, display_name, password_hash, is_active)
            VALUES (@id, @username, 'مستخدم ZZ-TEST Turnstile', @hash, TRUE);
            """, connection);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("username", username);
        command.Parameters.AddWithValue("hash", PasswordHasher.Hash(Password));
        await command.ExecuteNonQueryAsync();
        return new SeedUser(username);
    }

    private static async Task<(int Attempts, DateTimeOffset? LockedUntil)?> ReadAttemptAsync(string connectionString, string username)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT failed_attempts::int, locked_until FROM login_attempts WHERE username=lower(@u);", connection);
        command.Parameters.AddWithValue("u", username);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;
        return (reader.GetInt32(0), reader.IsDBNull(1) ? null : reader.GetFieldValue<DateTimeOffset>(1));
    }

    private sealed class SingleHttpClientFactory(HttpClient client) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => client;
    }

    private sealed class SiteverifyStub : IAsyncDisposable
    {
        private readonly WebApplication app;
        public string Url { get; }
        public int? ForceStatusCode { get; set; }

        private SiteverifyStub(WebApplication app, string url) { this.app = app; Url = url; }

        public static async Task<SiteverifyStub> StartAsync()
        {
            var builder = WebApplication.CreateBuilder();
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();
            var app = builder.Build();
            SiteverifyStub? self = null;
            app.MapPost("/siteverify", async (HttpContext context) =>
            {
                if (self?.ForceStatusCode is { } forced) return Results.StatusCode(forced);
                var form = await context.Request.ReadFormAsync();
                var token = form["response"].ToString();
                if (token.StartsWith("reject", StringComparison.Ordinal))
                    return Results.Json(new { success = false });
                var hostname = token.StartsWith("bad-host", StringComparison.Ordinal) ? "evil.example" : ExpectedHostname;
                var action = token.StartsWith("bad-action", StringComparison.Ordinal) ? "register" : ExpectedAction;
                return Results.Json(new { success = true, hostname, action });
            });
            await app.StartAsync();
            var url = app.Urls.First() + "/siteverify";
            self = new SiteverifyStub(app, url);
            return self;
        }

        public async ValueTask DisposeAsync()
        {
            await app.StopAsync();
            await app.DisposeAsync();
        }
    }
}