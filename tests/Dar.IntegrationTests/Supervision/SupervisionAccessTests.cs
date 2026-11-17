using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Dar.IntegrationTests.Supervision;

public sealed class SupervisionAccessTests(SupervisionFixture fixture) : IClassFixture<SupervisionFixture>
{
    private HttpClient Client()
    {
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["ConnectionStrings:Default"] = fixture.ConnectionString,
                    ["Auth:Otp:Pepper"] = "integration-test-pepper-1234567890"
                }));
        });
        return factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true
        });
    }

    [Fact]
    public async Task Unpaid_RespectsFinanceAndScope()
    {
        using var scoped = Client();
        await LoginAsync(scoped, "scope_c1");
        var scopedJson = await GetJson(scoped, "/api/v1/supervisor/unpaid");
        Assert.False(scopedJson.GetProperty("canViewAmounts").GetBoolean());
        Assert.Equal(1, scopedJson.GetProperty("count").GetInt32());
        Assert.Equal(JsonValueKind.Null, scopedJson.GetProperty("unpaid")[0].GetProperty("amountDue").ValueKind);

        using var all = Client();
        await LoginAsync(all, "scope_all");
        Assert.Equal(3, (await GetJson(all, "/api/v1/supervisor/unpaid")).GetProperty("count").GetInt32());

        using var finance = Client();
        await LoginAsync(finance, "finance_all");
        var financeRow = (await GetJson(finance, "/api/v1/supervisor/unpaid")).GetProperty("unpaid")[0];
        Assert.NotEqual(JsonValueKind.Null, financeRow.GetProperty("amountDue").ValueKind);
    }

    [Fact]
    public async Task Adjust_OutsideScope_ReturnsForbidden()
    {
        using var client = Client();
        await LoginAsync(client, "scope_c1");
        var response = await client.PostAsJsonAsync($"/api/v1/supervisor/attendance/{SupervisionFixture.A2}/adjust",
            new { payableDurationMinutes = 30, payableAmount = (decimal?)null, note = "محاولة خارج النطاق" });
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Notifications_RespectCircleScope_OnListAndRead()
    {
        using var client = Client();
        await LoginAsync(client, "scope_c1");
        var notifications = (await GetJson(client, "/api/v1/notifications?status=all")).GetProperty("notifications");
        Assert.Contains(notifications.EnumerateArray(), item => item.GetProperty("title").GetString() == "تنبيه أول");
        Assert.DoesNotContain(notifications.EnumerateArray(), item => item.GetProperty("title").GetString() == "تنبيه ثان");
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync($"/api/v1/notifications/{SupervisionFixture.N2}/read", null)).StatusCode);
    }

    [Fact]
    public async Task StudentSubscription_FiltersByCircleScope()
    {
        using var client = Client();
        await LoginAsync(client, "scope_c1");
        var subscriptions = (await GetJson(client, $"/api/v1/supervisor/students/{SupervisionFixture.S1}")).GetProperty("subscription");
        Assert.Equal(1, subscriptions.GetArrayLength());
        Assert.Equal("حلقة أولى", subscriptions[0].GetProperty("circleName").GetString());
        Assert.Equal(JsonValueKind.Null, subscriptions[0].GetProperty("amountDue").ValueKind);
    }

    [Fact]
    public async Task TeacherNotes_KindIsFilteredBeforeLimit()
    {
        using var client = Client();
        await LoginAsync(client, "scope_c1");
        var notes = (await GetJson(client, "/api/v1/supervisor/teacher-notes?kind=student")).GetProperty("notes");
        Assert.Equal(1, notes.GetArrayLength());
        Assert.All(notes.EnumerateArray(), item => Assert.Equal("student", item.GetProperty("kind").GetString()));
    }

    [Fact]
    public async Task TeacherRequest_ApprovalAppliesCorrection()
    {
        using var teacher = Client();
        await LoginAsync(teacher, "teacher1");
        var create = await teacher.PostAsJsonAsync("/api/v1/teacher/requests", new
        {
            type = "correction",
            attendanceId = SupervisionFixture.A1,
            reason = "المدة الصحيحة 75 دقيقة",
            proposedDurationMinutes = 75,
            proposedNote = "تصحيح المدة"
        });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);

        using var supervisor = Client();
        await LoginAsync(supervisor, "scope_c1");
        var requestId = (await GetJson(supervisor, "/api/v1/supervisor/requests")).GetProperty("requests")[0].GetProperty("id").GetGuid();
        var review = await supervisor.PostAsJsonAsync($"/api/v1/supervisor/requests/{requestId}/review", new { approve = true, note = "تم الاعتماد" });
        Assert.Equal(HttpStatusCode.OK, review.StatusCode);

        await using var connection = new Npgsql.NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = new Npgsql.NpgsqlCommand("SELECT duration_minutes, payable_amount FROM teacher_attendance WHERE id=@id;", connection);
        command.Parameters.AddWithValue("id", SupervisionFixture.A1);
        await using var reader = await command.ExecuteReaderAsync();
        await reader.ReadAsync();
        Assert.Equal(75, reader.GetInt32(0));
        Assert.Equal(62.50m, reader.GetDecimal(1));
    }

    [Fact]
    public async Task Communication_RequiresPermission_AndIsScoped()
    {
        using var denied = Client();
        await LoginAsync(denied, "scope_c1");
        var deniedResponse = await denied.PostAsJsonAsync("/api/v1/supervisor/communications/whatsapp", new
        {
            recipientType = "teacher",
            recipientId = SupervisionFixture.T1,
            templateKey = "teacher_followup"
        });
        Assert.Equal(HttpStatusCode.Forbidden, deniedResponse.StatusCode);

        using var allowed = Client();
        await LoginAsync(allowed, "comm_c1");
        var allowedResponse = await allowed.PostAsJsonAsync("/api/v1/supervisor/communications/whatsapp", new
        {
            recipientType = "teacher",
            recipientId = SupervisionFixture.T1,
            templateKey = "teacher_followup"
        });
        Assert.Equal(HttpStatusCode.OK, allowedResponse.StatusCode);
        var json = await allowedResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.StartsWith("https://wa.me/", json.GetProperty("href").GetString());
    }

    private static async Task<JsonElement> GetJson(HttpClient client, string path)
    {
        var response = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task LoginAsync(HttpClient client, string username)
    {
        var response = await client.PostAsJsonAsync("/api/v1/auth/password", new
        {
            username,
            password = SupervisionFixture.Password,
            rememberMe = false
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
