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
    public async Task StudentList_IncludesSubscriptionStatusOnly()
    {
        using var client = Client();
        await LoginAsync(client, "scope_c1");
        var students = (await GetJson(client, "/api/v1/supervisor/students")).GetProperty("students");
        var student = students.EnumerateArray().First(item => item.GetProperty("id").GetGuid() == SupervisionFixture.S1);
        Assert.Equal("partial", student.GetProperty("subscriptionStatus").GetString());
        Assert.False(student.TryGetProperty("amountDue", out _));
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

    [Fact]
    public async Task Communication_UsesAdminConfiguredTemplate()
    {
        const string template = "تنبيه مخصص: {name} في {circle} — {brand}";
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        try
        {
            await using (var update = new NpgsqlCommand("UPDATE school_settings SET whatsapp_template_absence=@body WHERE id=1;", connection))
            {
                update.Parameters.AddWithValue("body", template);
                await update.ExecuteNonQueryAsync();
            }

            using var client = Client();
            await LoginAsync(client, "comm_c1");
            var response = await client.PostAsJsonAsync("/api/v1/supervisor/communications/whatsapp", new
            {
                recipientType = "student_guardian",
                recipientId = SupervisionFixture.S1,
                templateKey = "absence"
            });
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var json = await response.Content.ReadFromJsonAsync<JsonElement>();
            const string expected = "تنبيه مخصص: طالبة أولى في حلقة أولى — دار الإمام حفص للقرآن والتجويد";
            Assert.Equal(expected, json.GetProperty("message").GetString());
            Assert.Contains(Uri.EscapeDataString(expected), json.GetProperty("href").GetString());
        }
        finally
        {
            await using var restore = new NpgsqlCommand("UPDATE school_settings SET whatsapp_template_absence='مرحبًا، نود متابعة غياب {name} عن {circle}.' WHERE id=1;", connection);
            await restore.ExecuteNonQueryAsync();
        }
    }

    [Fact]
    public async Task TeacherNotes_ReturnsActiveBannerAndHidesItWhenDisabled()
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        try
        {
            await using (var update = new NpgsqlCommand("UPDATE school_settings SET teacher_notes_banner=@banner, teacher_notes_banner_active=TRUE WHERE id=1;", connection))
            {
                update.Parameters.AddWithValue("banner", "رسالة إدارية تجريبية");
                await update.ExecuteNonQueryAsync();
            }

            using var client = Client();
            await LoginAsync(client, "scope_c1");
            var json = await GetJson(client, "/api/v1/supervisor/teacher-notes");
            Assert.Equal("رسالة إدارية تجريبية", json.GetProperty("banner").GetString());

            await using (var disable = new NpgsqlCommand("UPDATE school_settings SET teacher_notes_banner_active=FALSE WHERE id=1;", connection))
                await disable.ExecuteNonQueryAsync();
            var disabled = await GetJson(client, "/api/v1/supervisor/teacher-notes");
            Assert.Equal(JsonValueKind.Null, disabled.GetProperty("banner").ValueKind);
        }
        finally
        {
            await using var restore = new NpgsqlCommand("UPDATE school_settings SET teacher_notes_banner='', teacher_notes_banner_active=TRUE WHERE id=1;", connection);
            await restore.ExecuteNonQueryAsync();
        }
    }

    [Fact]
    public async Task TeacherCalendar_ReturnsWeeklyDaysAndSeededSession()
    {
        using var teacher = Client();
        await LoginAsync(teacher, "teacher1");
        var json = await GetJson(teacher, "/api/v1/teacher/calendar?days=7");
        var days = json.GetProperty("days");
        Assert.Equal(7, days.GetArrayLength());
        Assert.All(days.EnumerateArray(), day => Assert.Equal(JsonValueKind.String, day.GetProperty("date").ValueKind));
        var sessionCount = days.EnumerateArray().Sum(day => day.GetProperty("sessions").GetArrayLength());
        Assert.True(sessionCount >= 1);
    }

    [Fact]
    public async Task TeacherHistory_ReturnsAttendanceAndLoginSessions()
    {
        using var teacher = Client();
        await LoginAsync(teacher, "teacher1");
        var json = await GetJson(teacher, "/api/v1/teacher/history?limit=20");
        Assert.True(json.GetProperty("attendance").GetArrayLength() >= 1);
        Assert.Equal(JsonValueKind.Array, json.GetProperty("logins").ValueKind);
    }

    [Fact]
    public async Task SupervisorAdjust_BlockedWhenPayrollLocked()
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        try
        {
            await using (var lockCommand = new NpgsqlCommand("""
                INSERT INTO payroll_locks(billing_month,is_locked,note) VALUES(date_trunc('month',CURRENT_DATE)::date,TRUE,'اختبار قفل')
                ON CONFLICT(billing_month) DO UPDATE SET is_locked=TRUE;
                """, connection))
                await lockCommand.ExecuteNonQueryAsync();

            using var client = Client();
            await LoginAsync(client, "scope_all");
            var response = await client.PostAsJsonAsync($"/api/v1/supervisor/attendance/{SupervisionFixture.A1}/adjust",
                new { payableDurationMinutes = 30, payableAmount = (decimal?)null, note = "محاولة بعد القفل" });
            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        }
        finally
        {
            await using var clear = new NpgsqlCommand("DELETE FROM payroll_locks WHERE billing_month=date_trunc('month',CURRENT_DATE)::date;", connection);
            await clear.ExecuteNonQueryAsync();
        }
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
