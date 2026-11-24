using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Dar.Modules.Identity.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Dar.IntegrationTests.Meet;

/// <summary>
/// P0-2 regression test: recording list and media stream/download must respect the caller's
/// circle scope. An admin (users.manage) sees everything; a restricted supervisor only sees
/// recordings linked to allowed circles; manual recordings without a circle stay admin-only.
/// Requires DAR_TEST_DATABASE pointing at a disposable database with the production schema.
/// </summary>
public sealed class MeetMediaScopeTests
{
    private const string EnvName = "DAR_TEST_DATABASE";
    private const string Password = "TestPass123!";

    private static readonly Guid ScopedUser = Guid.Parse("7a000000-0000-4000-8000-00000000e001");
    private static readonly Guid AdminUser = Guid.Parse("7a000000-0000-4000-8000-00000000e002");
    private static readonly Guid CircleA = Guid.Parse("7a000000-0000-4000-8000-00000000c001");
    private static readonly Guid CircleB = Guid.Parse("7a000000-0000-4000-8000-00000000c002");
    private static readonly Guid SessionA = Guid.Parse("7a000000-0000-4000-8000-00000000a001");
    private static readonly Guid SessionB = Guid.Parse("7a000000-0000-4000-8000-00000000a002");
    private static readonly Guid SessionManual = Guid.Parse("7a000000-0000-4000-8000-00000000a003");
    private static readonly Guid AssetA = Guid.Parse("7a000000-0000-4000-8000-00000000b001");
    private static readonly Guid AssetB = Guid.Parse("7a000000-0000-4000-8000-00000000b002");
    private static readonly Guid AssetManual = Guid.Parse("7a000000-0000-4000-8000-00000000b003");

    private static string MediaRoot => Path.Combine(Path.GetTempPath(), "dar-p02-meet-media");

    private static string? ConnectionString => Environment.GetEnvironmentVariable(EnvName);

    [Fact]
    public async Task ScopedSupervisor_ListSeesOnlyOwnCircleRecordings()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        await SeedAsync(ConnectionString!);
        using var client = Client();
        await LoginAsync(client, "p02_scope_a");

        var json = await GetJson(client, "/api/v1/meet/sessions");
        var sessions = json.GetProperty("sessions").EnumerateArray().Select(item => item.GetProperty("id").GetGuid()).ToArray();
        Assert.Equal(1, json.GetProperty("count").GetInt32());
        Assert.Contains(SessionA, sessions);
        Assert.DoesNotContain(SessionB, sessions);
        Assert.DoesNotContain(SessionManual, sessions);
    }

    [Fact]
    public async Task ScopedSupervisor_CannotStreamOrDownloadOutOfScopeRecording()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        await SeedAsync(ConnectionString!);
        using var client = Client();
        await LoginAsync(client, "p02_scope_a");

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/meet/media/{AssetB}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/meet/media/{AssetB}?download=true")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/v1/meet/media/{AssetManual}")).StatusCode);
    }

    [Fact]
    public async Task ScopedSupervisor_CanStreamInScopeRecording()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        await SeedAsync(ConnectionString!);
        using var client = Client();
        await LoginAsync(client, "p02_scope_a");

        var response = await client.GetAsync($"/api/v1/meet/media/{AssetA}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("video/mp4", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Admin_SeesEverythingIncludingManualRecording()
    {
        if (string.IsNullOrWhiteSpace(ConnectionString)) return;
        await SeedAsync(ConnectionString!);
        using var client = Client();
        await LoginAsync(client, "p02_admin");

        var json = await GetJson(client, "/api/v1/meet/sessions");
        var sessions = json.GetProperty("sessions").EnumerateArray().Select(item => item.GetProperty("id").GetGuid()).ToArray();
        Assert.Equal(3, json.GetProperty("count").GetInt32());
        Assert.Contains(SessionA, sessions);
        Assert.Contains(SessionB, sessions);
        Assert.Contains(SessionManual, sessions);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/v1/meet/media/{AssetB}")).StatusCode);
    }

    private static HttpClient Client()
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:Default"] = ConnectionString,
                    ["Auth:Otp:Pepper"] = "integration-test-pepper-1234567890",
                    ["Meet:MediaRoot"] = MediaRoot
                }));
        });
        return factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true
        });
    }

    private static async Task LoginAsync(HttpClient client, string username)
    {
        var response = await client.PostAsJsonAsync("/api/v1/auth/password", new
        {
            username,
            password = Password,
            rememberMe = false
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static async Task<JsonElement> GetJson(HttpClient client, string path)
    {
        var response = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task SeedAsync(string connectionString)
    {
        Directory.CreateDirectory(MediaRoot);
        var aPath = Path.Combine(MediaRoot, "p02-a.mp4");
        var bPath = Path.Combine(MediaRoot, "p02-b.mp4");
        var mPath = Path.Combine(MediaRoot, "p02-manual.mp4");
        if (!File.Exists(aPath)) File.WriteAllBytes(aPath, RandomNumberGenerator.GetBytes(64));
        if (!File.Exists(bPath)) File.WriteAllBytes(bPath, RandomNumberGenerator.GetBytes(64));
        if (!File.Exists(mPath)) File.WriteAllBytes(mPath, RandomNumberGenerator.GetBytes(64));

        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("""
            INSERT INTO circles(id, circle_code, name, monthly_fee, is_active, starts_on)
            VALUES (@c1, 'P02-C1', 'دائرة P0-2 أ', 0, TRUE, DATE '2026-01-01'),
                   (@c2, 'P02-C2', 'دائرة P0-2 ب', 0, TRUE, DATE '2026-01-01')
            ON CONFLICT (id) DO NOTHING;

            INSERT INTO app_users(id, username, display_name, password_hash, is_active)
            VALUES (@scoped, 'p02_scope_a', 'مشرفة نطاق P0-2', @hash, TRUE),
                   (@admin, 'p02_admin', 'أدمن P0-2', @hash, TRUE)
            ON CONFLICT (id) DO NOTHING;

            INSERT INTO user_permissions(user_id, permission_code) VALUES
              (@scoped, 'meet.media.view'),
              (@admin, 'meet.media.view'),
              (@admin, 'users.manage')
            ON CONFLICT DO NOTHING;

            INSERT INTO app_user_scopes(user_id, scope_type, scope_id)
            VALUES (@scoped, 'circle', @c1)
            ON CONFLICT DO NOTHING;

            INSERT INTO meet_sessions(id, circle_id, status, started_at, duration_seconds, participants)
            VALUES (@sa, @c1, 'ready', now() - INTERVAL '2 hours', 60, 2),
                   (@sb, @c2, 'ready', now() - INTERVAL '3 hours', 60, 2),
                   (@sm, NULL, 'ready', now() - INTERVAL '4 hours', 60, 2)
            ON CONFLICT (id) DO NOTHING;

            INSERT INTO meet_media_assets(id, session_id, kind, local_path, size_bytes, status)
            VALUES (@aa, @sa, 'mp4', @pa, 64, 'local'),
                   (@ab, @sb, 'mp4', @pb, 64, 'local'),
                   (@am, @sm, 'mp4', @pm, 64, 'local')
            ON CONFLICT (id) DO NOTHING;
            """, connection);
        command.Parameters.AddWithValue("c1", CircleA);
        command.Parameters.AddWithValue("c2", CircleB);
        command.Parameters.AddWithValue("scoped", ScopedUser);
        command.Parameters.AddWithValue("admin", AdminUser);
        command.Parameters.AddWithValue("hash", PasswordHasher.Hash(Password));
        command.Parameters.AddWithValue("sa", SessionA);
        command.Parameters.AddWithValue("sb", SessionB);
        command.Parameters.AddWithValue("sm", SessionManual);
        command.Parameters.AddWithValue("aa", AssetA);
        command.Parameters.AddWithValue("ab", AssetB);
        command.Parameters.AddWithValue("am", AssetManual);
        command.Parameters.AddWithValue("pa", aPath);
        command.Parameters.AddWithValue("pb", bPath);
        command.Parameters.AddWithValue("pm", mPath);
        await command.ExecuteNonQueryAsync();
    }
}
