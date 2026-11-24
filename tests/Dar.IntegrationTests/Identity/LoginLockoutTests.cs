using System.Net;
using System.Net.Http.Json;
using Dar.Modules.Identity.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Dar.IntegrationTests.Identity;

/// <summary>
/// P1-1 regression tests: progressive per-account login lockout on /api/v1/auth/password.
/// Requires DAR_TEST_DATABASE pointing at a disposable database with the production schema.
/// </summary>
public sealed class LoginLockoutTests
{
    private const string EnvName = "DAR_TEST_DATABASE";
    private const string Password = "TestPass123!";

    private static string? ConnectionString => Environment.GetEnvironmentVariable(EnvName);

    [Fact]
    public async Task FiveFailures_LockOnlyThatAccount_AndCorrectPasswordIsBlocked()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        var (lockedUser, otherUser) = await SeedTwoUsersAsync(ConnectionString!);
        using var client = Client(ConnectionString!);

        for (var attempt = 1; attempt <= 4; attempt++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await LoginAsync(client, lockedUser.Username, "wrong-password")).StatusCode);

        var fifth = await LoginAsync(client, lockedUser.Username, "wrong-password");
        Assert.Equal((HttpStatusCode)429, fifth.StatusCode);
        Assert.NotNull(fifth.Headers.RetryAfter);
        Assert.True(fifth.Headers.RetryAfter!.Delta?.TotalSeconds >= 30);

        // Correct password while locked is still rejected with 429.
        Assert.Equal((HttpStatusCode)429, (await LoginAsync(client, lockedUser.Username, Password)).StatusCode);

        // The other account is untouched and can sign in.
        Assert.Equal(HttpStatusCode.OK, (await LoginAsync(client, otherUser.Username, Password)).StatusCode);
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT failed_login_attempts, login_locked_until FROM app_users WHERE id=@id;", connection);
        command.Parameters.AddWithValue("id", otherUser.Id);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal(0, reader.GetInt32(0));
        Assert.True(reader.IsDBNull(1));
    }

    [Fact]
    public async Task LockExpiry_AllowsLogin_AndResetsCounter()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        var user = await SeedUserAsync(ConnectionString!, "p11_expiry");
        using var client = Client(ConnectionString!);
        for (var attempt = 1; attempt <= 5; attempt++) await LoginAsync(client, user.Username, "wrong-password");

        await using (var connection = new NpgsqlConnection(ConnectionString))
        {
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand("UPDATE app_users SET login_locked_until = now() - INTERVAL '1 second' WHERE id=@id;", connection);
            command.Parameters.AddWithValue("id", user.Id);
            await command.ExecuteNonQueryAsync();
        }

        Assert.Equal(HttpStatusCode.OK, (await LoginAsync(client, user.Username, Password)).StatusCode);
        await using var verify = new NpgsqlConnection(ConnectionString);
        await verify.OpenAsync();
        await using var check = new NpgsqlCommand("SELECT failed_login_attempts, login_locked_until FROM app_users WHERE id=@id;", verify);
        check.Parameters.AddWithValue("id", user.Id);
        await using var reader = await check.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal(0, reader.GetInt32(0));
        Assert.True(reader.IsDBNull(1));
    }

    [Fact]
    public async Task ManualLock_RemainsUnauthorized_AndUnknownUserStaysGeneric()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        var user = await SeedUserAsync(ConnectionString!, "p11_manual");
        using var client = Client(ConnectionString!);

        await using (var connection = new NpgsqlConnection(ConnectionString))
        {
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand("UPDATE app_users SET is_locked=TRUE WHERE id=@id;", connection);
            command.Parameters.AddWithValue("id", user.Id);
            await command.ExecuteNonQueryAsync();
        }
        Assert.Equal(HttpStatusCode.Unauthorized, (await LoginAsync(client, user.Username, Password)).StatusCode);

        for (var attempt = 1; attempt <= 5; attempt++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await LoginAsync(client, "no_such_p11_user", "wrong-password")).StatusCode);
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
                    ["Auth:Otp:Pepper"] = "integration-test-pepper-1234567890",
                    ["Auth:RateLimit:PermitLimit"] = "1000"
                }));
        });
        return factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true
        });
    }

    private static Task<HttpResponseMessage> LoginAsync(HttpClient client, string username, string password) =>
        client.PostAsJsonAsync("/api/v1/auth/password", new { username, password, rememberMe = false });

    private sealed record SeedUser(Guid Id, string Username);

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

    private static async Task<(SeedUser Locked, SeedUser Other)> SeedTwoUsersAsync(string connectionString) =>
        (await SeedUserAsync(connectionString, "p11_locked"), await SeedUserAsync(connectionString, "p11_other"));
}
