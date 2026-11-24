using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using Dar.Common.Domain;
using Dar.Modules.Identity.Abstractions;
using Dar.Modules.Identity.Features.PasswordSignIn;
using Dar.Modules.Identity.Persistence;
using Dar.Modules.Identity.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Dar.IntegrationTests.Identity;

/// <summary>
/// P1-1 regression tests: unified per-username lockout (no existence leak), atomic concurrency,
/// bounded cleanup, and reset/expiry. Requires DAR_TEST_DATABASE (disposable DB, migration 030 applied).
/// </summary>
public sealed class LoginLockoutTests
{
    private const string EnvName = "DAR_TEST_DATABASE";
    private const string Password = "TestPass123!";

    private static string? ConnectionString => Environment.GetEnvironmentVariable(EnvName);

    [Fact]
    public async Task ExistingAndUnknownUsernames_ReturnIdenticalFailures()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        var existing = await SeedUserAsync(ConnectionString!, "p11_parity");
        var unknown = "p11_unknown_" + Guid.NewGuid().ToString("N")[..10];
        await using var dataSource = NpgsqlDataSource.Create(ConnectionString!);
        var handler = new PasswordSignInHandler(new IdentityRepository(dataSource));

        for (var attempt = 1; attempt <= 4; attempt++)
        {
            var existingFailure = await LoginFailureAsync(handler, existing.Username, "wrong-password");
            var unknownFailure = await LoginFailureAsync(handler, unknown, "wrong-password");
            Assert.Equal(HttpStatusCode.Unauthorized, (HttpStatusCode)existingFailure!.StatusCode);
            Assert.Equal(existingFailure.StatusCode, unknownFailure!.StatusCode);
            Assert.Equal(existingFailure.Message, unknownFailure.Message);
        }

        var existingLock = await LoginFailureAsync(handler, existing.Username, "wrong-password");
        var unknownLock = await LoginFailureAsync(handler, unknown, "wrong-password");
        Assert.Equal(429, existingLock!.StatusCode);
        Assert.Equal(429, unknownLock!.StatusCode);
        Assert.Equal(existingLock.Message, unknownLock.Message);
        Assert.NotNull(existingLock.RetryAfterSeconds);
        Assert.Equal(existingLock.RetryAfterSeconds, unknownLock.RetryAfterSeconds);

        var existingRow = await ReadAttemptAsync(ConnectionString!, existing.Username);
        var unknownRow = await ReadAttemptAsync(ConnectionString!, unknown);
        Assert.NotNull(existingRow);
        Assert.NotNull(unknownRow);
        Assert.True(existingRow!.Attempts >= 5);
        Assert.True(unknownRow!.Attempts >= 5);
        Assert.NotNull(existingRow!.LockedUntil);
        Assert.NotNull(unknownRow!.LockedUntil);
    }

    [Fact]
    public async Task UnknownUsername_StillPaysThePasswordHashCost()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        var existing = await SeedUserAsync(ConnectionString!, "p11_timing");
        var unknown = "p11_timing_" + Guid.NewGuid().ToString("N")[..10];
        await using var dataSource = NpgsqlDataSource.Create(ConnectionString!);
        var handler = new PasswordSignInHandler(new IdentityRepository(dataSource));

        // Warm up both paths once (static dummy hash + JIT).
        await LoginFailureAsync(handler, existing.Username, "wrong");
        await LoginFailureAsync(handler, unknown, "wrong");

        static async Task<double> AverageMsAsync(PasswordSignInHandler h, string user)
        {
            var sw = new Stopwatch();
            var total = 0.0;
            for (var i = 0; i < 3; i++)
            {
                sw.Restart();
                await LoginFailureAsync(h, user, "wrong");
                sw.Stop();
                total += sw.Elapsed.TotalMilliseconds;
            }
            return total / 3;
        }

        var existingMs = await AverageMsAsync(handler, existing.Username);
        var unknownMs = await AverageMsAsync(handler, unknown);
        // A missing dummy hash would make the unknown path nearly free; both must do real PBKDF2 work.
        Assert.True(unknownMs >= 20, $"unknown username path skipped hashing ({unknownMs:0.0} ms)");
        Assert.True(Math.Abs(existingMs - unknownMs) < 250, $"timing differs too much ({existingMs:0.0} vs {unknownMs:0.0} ms)");
    }

    [Fact]
    public async Task ConcurrentFailures_CannotBypassTheLock()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        var user = await SeedUserAsync(ConnectionString!, "p11_concurrent");
        await using var dataSource = NpgsqlDataSource.Create(ConnectionString!);
        var handler = new PasswordSignInHandler(new IdentityRepository(dataSource));

        var tasks = Enumerable.Range(0, 20)
            .Select(_ => LoginFailureAsync(handler, user.Username, "wrong-password"))
            .ToArray();
        var failures = await Task.WhenAll(tasks);

        Assert.All(failures, failure => Assert.Contains(failure!.StatusCode, new[] { 401, 429 }));
        Assert.Contains(failures, failure => failure!.StatusCode == 429);
        var row = await ReadAttemptAsync(ConnectionString!, user.Username);
        Assert.NotNull(row);
        Assert.True(row!.Attempts >= 5);
        Assert.True(row!.LockedUntil > DateTimeOffset.UtcNow);
    }

    [Fact]
    public async Task Cleanup_KeepsActiveLocks_AndEnforcesSizeCap()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        var active = "p11_active_" + Guid.NewGuid().ToString("N")[..8];
        var expired = "p11_expired_" + Guid.NewGuid().ToString("N")[..8];
        var stale = "p11_stale_" + Guid.NewGuid().ToString("N")[..8];
        var fillers = Enumerable.Range(0, 8).Select(i => $"p11_fill_{i}_" + Guid.NewGuid().ToString("N")[..8]).ToArray();
        await using (var connection = new NpgsqlConnection(ConnectionString))
        {
            await connection.OpenAsync();
            await using (var cmd = new NpgsqlCommand("""
                INSERT INTO login_attempts(username, failed_attempts, locked_until, last_failed_at, updated_at) VALUES
                  (@active, 5, now() + INTERVAL '10 minutes', now(), now()),
                  (@expired, 5, now() - INTERVAL '2 minutes', now() - INTERVAL '40 days', now() - INTERVAL '40 days'),
                  (@stale, 2, NULL, now() - INTERVAL '40 days', now() - INTERVAL '40 days');
                """, connection))
            {
                cmd.Parameters.AddWithValue("active", active);
                cmd.Parameters.AddWithValue("expired", expired);
                cmd.Parameters.AddWithValue("stale", stale);
                await cmd.ExecuteNonQueryAsync();
            }
            foreach (var filler in fillers)
            {
                await using var cmd = new NpgsqlCommand("INSERT INTO login_attempts(username, failed_attempts, last_failed_at, updated_at) VALUES(@u, 1, now() - INTERVAL '31 days', now() - INTERVAL '31 days');", connection);
                cmd.Parameters.AddWithValue("u", filler);
                await cmd.ExecuteNonQueryAsync();
            }
            await using var cleanup = new NpgsqlCommand("SELECT cleanup_login_attempts(5);", connection);
            await cleanup.ExecuteScalarAsync();
        }

        var activeRow = await ReadAttemptAsync(ConnectionString!, active);
        Assert.NotNull(activeRow);
        Assert.NotNull(activeRow!.LockedUntil);
        Assert.Null(await ReadAttemptAsync(ConnectionString!, expired));
        Assert.Null(await ReadAttemptAsync(ConnectionString!, stale));
        await using var verify = new NpgsqlConnection(ConnectionString);
        await verify.OpenAsync();
        await using var count = new NpgsqlCommand("SELECT count(*) FROM login_attempts;", verify);
        var total = (long)(await count.ExecuteScalarAsync() ?? 0L);
        Assert.True(total <= 5, $"cleanup left {total} rows with cap 5");
    }

    [Fact]
    public async Task ExpiredLock_AllowsLogin_AndResetsCounter()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        var user = await SeedUserAsync(ConnectionString!, "p11_expiry2");
        await using (var connection = new NpgsqlConnection(ConnectionString))
        {
            await connection.OpenAsync();
            await using var cmd = new NpgsqlCommand("""
                INSERT INTO login_attempts(username, failed_attempts, locked_until, last_failed_at, updated_at)
                VALUES(lower(@u), 5, now() - INTERVAL '1 second', now(), now());
                """, connection);
            cmd.Parameters.AddWithValue("u", user.Username);
            await cmd.ExecuteNonQueryAsync();
        }
        using var client = Client(ConnectionString!);
        Assert.Equal(HttpStatusCode.OK, (await LoginAsync(client, user.Username, Password)).StatusCode);
        Assert.Null(await ReadAttemptAsync(ConnectionString!, user.Username));
    }

    [Fact]
    public async Task ManualLock_RemainsUnauthorized()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        var user = await SeedUserAsync(ConnectionString!, "p11_manual2");
        await using (var connection = new NpgsqlConnection(ConnectionString))
        {
            await connection.OpenAsync();
            await using var cmd = new NpgsqlCommand("UPDATE app_users SET is_locked=TRUE WHERE id=@id;", connection);
            cmd.Parameters.AddWithValue("id", user.Id);
            await cmd.ExecuteNonQueryAsync();
        }
        using var client = Client(ConnectionString!);
        Assert.Equal(HttpStatusCode.Unauthorized, (await LoginAsync(client, user.Username, Password)).StatusCode);
    }

    private static async Task<AppException?> LoginFailureAsync(PasswordSignInHandler handler, string username, string password)
    {
        try
        {
            await handler.HandleAsync(new PasswordSignInRequest(username, password), new DefaultHttpContext(), CancellationToken.None);
            return null;
        }
        catch (AppException exception)
        {
            return exception;
        }
    }

    private static HttpClient Client(string connectionString)
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:Default"] = connectionString,
                    ["Auth:Otp:Pepper"] = "integration-test-pepper-1234567890"
                }));
        });
        return factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = true });
    }

    private static Task<HttpResponseMessage> LoginAsync(HttpClient client, string username, string password) =>
        client.PostAsJsonAsync("/api/v1/auth/password", new { username, password, rememberMe = false });

    private sealed record SeedUser(Guid Id, string Username);
    private sealed record AttemptRow(int Attempts, DateTimeOffset? LockedUntil);

    private static async Task<SeedUser> SeedUserAsync(string connectionString, string usernamePrefix)
    {
        var id = Guid.NewGuid();
        var username = usernamePrefix + "_" + Guid.NewGuid().ToString("N")[..8];
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("""
            INSERT INTO app_users(id, username, display_name, password_hash, is_active)
            VALUES (@id, @username, 'مستخدم اختبار القفل', @hash, TRUE);
            """, connection);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("username", username);
        command.Parameters.AddWithValue("hash", PasswordHasher.Hash(Password));
        await command.ExecuteNonQueryAsync();
        return new SeedUser(id, username);
    }

    private static async Task<AttemptRow?> ReadAttemptAsync(string connectionString, string username)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT failed_attempts::int, locked_until FROM login_attempts WHERE username=lower(@username);", connection);
        command.Parameters.AddWithValue("username", username);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;
        return new AttemptRow(reader.GetInt32(0), reader.IsDBNull(1) ? null : reader.GetFieldValue<DateTimeOffset>(1));
    }
}
