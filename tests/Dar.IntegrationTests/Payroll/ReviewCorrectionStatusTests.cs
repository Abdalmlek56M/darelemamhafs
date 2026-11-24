using System.Security.Claims;
using Dar.Modules.Teaching.Features.Requests;
using Microsoft.AspNetCore.Http;
using Npgsql;

namespace Dar.IntegrationTests.Payroll;

/// <summary>
/// P0-5 regression test: approving a correction request applies the proposed attendance status
/// together with duration and payable amount in one transaction, and the payroll lock still wins.
/// Requires DAR_TEST_DATABASE pointing at a disposable database with the production schema.
/// </summary>
public sealed class ReviewCorrectionStatusTests
{
    private const string EnvName = "DAR_TEST_DATABASE";
    private static readonly Guid ReviewerId = Guid.Parse("7d000000-0000-4000-8000-00000000e001");

    private sealed record Fixture(Guid RequestId, Guid AttendanceId);

    [Fact]
    public async Task AbsentToPresent_AppliesStatusDurationAndPay()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(EnvName))) return;
        await using var dataSource = NpgsqlDataSource.Create(Environment.GetEnvironmentVariable(EnvName)!);
        var fixture = await SeedAsync(dataSource, "absent-to-present", new DateOnly(2026, 12, 7),
            currentStatus: "absent", currentAmount: 0m,
            payload: "{\"durationMinutes\":30,\"note\":\"P0-5\",\"status\":\"present\"}", locked: false);

        var result = await ReviewAsync(dataSource, fixture.RequestId);
        Assert.Equal(StatusCodes.Status200OK, Status(result));

        var (status, duration, amount, requestStatus) = await ReadStateAsync(dataSource, fixture);
        Assert.Equal("present", status);
        Assert.Equal(30, duration);
        Assert.Equal(30m, amount);
        Assert.Equal("approved", requestStatus);
    }

    [Fact]
    public async Task PresentToAbsent_AppliesStatusAndClearsPay()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(EnvName))) return;
        await using var dataSource = NpgsqlDataSource.Create(Environment.GetEnvironmentVariable(EnvName)!);
        var fixture = await SeedAsync(dataSource, "present-to-absent", new DateOnly(2026, 12, 8),
            currentStatus: "present", currentAmount: 60m,
            payload: "{\"durationMinutes\":45,\"note\":\"P0-5\",\"status\":\"absent\"}", locked: false);

        var result = await ReviewAsync(dataSource, fixture.RequestId);
        Assert.Equal(StatusCodes.Status200OK, Status(result));

        var (status, duration, amount, requestStatus) = await ReadStateAsync(dataSource, fixture);
        Assert.Equal("absent", status);
        Assert.Equal(45, duration);
        Assert.Equal(0m, amount);
        Assert.Equal("approved", requestStatus);
    }

    [Fact]
    public async Task LockedMonth_RejectsStatusChangeAndKeepsRecord()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(EnvName))) return;
        await using var dataSource = NpgsqlDataSource.Create(Environment.GetEnvironmentVariable(EnvName)!);
        var fixture = await SeedAsync(dataSource, "locked-status", new DateOnly(2026, 10, 5),
            currentStatus: "absent", currentAmount: 0m,
            payload: "{\"durationMinutes\":30,\"note\":\"P0-5\",\"status\":\"present\"}", locked: true);

        var result = await ReviewAsync(dataSource, fixture.RequestId);
        Assert.Equal(StatusCodes.Status409Conflict, Status(result));

        var (status, duration, amount, requestStatus) = await ReadStateAsync(dataSource, fixture);
        Assert.Equal("absent", status);
        Assert.Equal(60, duration);
        Assert.Equal(0m, amount);
        Assert.Equal("pending", requestStatus);
    }

    [Fact]
    public async Task InvalidStatus_IsRejectedWithoutChanges()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(EnvName))) return;
        await using var dataSource = NpgsqlDataSource.Create(Environment.GetEnvironmentVariable(EnvName)!);
        var fixture = await SeedAsync(dataSource, "invalid-status", new DateOnly(2026, 12, 9),
            currentStatus: "present", currentAmount: 60m,
            payload: "{\"durationMinutes\":30,\"note\":\"P0-5\",\"status\":\"bogus\"}", locked: false);

        var result = await ReviewAsync(dataSource, fixture.RequestId);
        Assert.Equal(StatusCodes.Status400BadRequest, Status(result));

        var (status, duration, amount, requestStatus) = await ReadStateAsync(dataSource, fixture);
        Assert.Equal("present", status);
        Assert.Equal(60, duration);
        Assert.Equal(60m, amount);
        Assert.Equal("pending", requestStatus);
    }

    [Fact]
    public async Task MissingStatus_KeepsCurrentStatus_ForOldRequests()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(EnvName))) return;
        await using var dataSource = NpgsqlDataSource.Create(Environment.GetEnvironmentVariable(EnvName)!);
        var fixture = await SeedAsync(dataSource, "missing-status", new DateOnly(2026, 12, 10),
            currentStatus: "present", currentAmount: 60m,
            payload: "{\"durationMinutes\":20,\"note\":\"P0-5\"}", locked: false);

        var result = await ReviewAsync(dataSource, fixture.RequestId);
        Assert.Equal(StatusCodes.Status200OK, Status(result));

        var (status, duration, amount, requestStatus) = await ReadStateAsync(dataSource, fixture);
        Assert.Equal("present", status);
        Assert.Equal(20, duration);
        Assert.Equal(20m, amount);
        Assert.Equal("approved", requestStatus);
    }

    private static async Task<IResult> ReviewAsync(NpgsqlDataSource dataSource, Guid requestId) =>
        await SupervisorRequestEndpoints.Review(requestId, new ReviewRequestRequest(true, null),
            Principal(), dataSource, CancellationToken.None);

    private static int? Status(IResult result) => (result as IStatusCodeHttpResult)?.StatusCode;

    private static ClaimsPrincipal Principal() => new(new ClaimsIdentity(
    [
        new Claim(ClaimTypes.NameIdentifier, ReviewerId.ToString()),
        new Claim("display_name", "مراجع اختبار P0-5"),
        new Claim("permission", "users.manage")
    ], "test"));

    private static async Task<Fixture> SeedAsync(NpgsqlDataSource dataSource, string tagPrefix, DateOnly date,
        string currentStatus, decimal currentAmount, string payload, bool locked)
    {
        var tag = tagPrefix + "-" + Guid.NewGuid().ToString("N")[..8];
        var teacherId = Guid.NewGuid();
        var circleId = Guid.NewGuid();
        var slotId = Guid.NewGuid();
        var sessionId = Guid.NewGuid();
        var attendanceId = Guid.NewGuid();
        var requestId = Guid.NewGuid();
        var month = new DateOnly(date.Year, date.Month, 1);

        await using var connection = await dataSource.OpenConnectionAsync();
        await using (var user = new NpgsqlCommand("""
            INSERT INTO app_users(id, username, display_name, password_hash)
            VALUES (@id, 'p05_reviewer_' || @tag, 'مراجع اختبار P0-5', 'not-a-real-hash')
            ON CONFLICT (id) DO NOTHING;
            """, connection))
        {
            user.Parameters.AddWithValue("id", ReviewerId);
            user.Parameters.AddWithValue("tag", tag);
            await user.ExecuteNonQueryAsync();
        }

        await using var seed = new NpgsqlCommand("""
            INSERT INTO teachers(id, teacher_code, full_name, status, hourly_rate)
            VALUES (@teacher, @teacherCode, 'معلمة اختبار الحالة', 'active', 60);

            INSERT INTO circles(id, circle_code, name, teacher_id, monthly_fee, is_active, starts_on)
            VALUES (@circle, @circleCode, 'حلقة اختبار الحالة', @teacher, 0, TRUE, DATE '2026-01-01');

            INSERT INTO circle_schedule_slots(id, circle_id, day_of_week, starts_at, duration_minutes)
            VALUES (@slot, @circle, 1, TIME '10:00', 60);

            INSERT INTO teacher_sessions(id, teacher_id, circle_id, schedule_slot_id, session_date, started_at, ended_at,
                                         status, scheduled_duration_minutes, actual_duration_minutes, payable_duration_minutes, pay_basis)
            VALUES (@session, @teacher, @circle, @slot, @date, @startedAt, @startedAt + INTERVAL '60 minutes',
                    'completed', 60, 60, 60, 'actual');

            INSERT INTO teacher_attendance(id, schedule_slot_id, circle_id, teacher_id, session_date, scheduled_start,
                                           duration_minutes, status, hourly_rate_snapshot, payable_amount, marked_by,
                                           teacher_session_id, actual_duration_minutes, pay_basis)
            VALUES (@attendance, @slot, @circle, @teacher, @date, TIME '10:00',
                    60, @currentStatus, 60, @currentAmount, @reviewer, @session, 60, 'actual');

            INSERT INTO attendance_requests(id, request_type, teacher_id, circle_id, schedule_slot_id, attendance_id,
                                            request_date, requested_by, reason, requested_payload, status)
            VALUES (@request, 'correction', @teacher, @circle, @slot, @attendance,
                    @date, @reviewer, 'طلب تصحيح اختبار الحالة', @payload::jsonb, 'pending');

            INSERT INTO payroll_locks(billing_month, is_locked, locked_by, locked_at)
            VALUES (@month, @locked, @reviewer, now())
            ON CONFLICT (billing_month) DO UPDATE SET is_locked = EXCLUDED.is_locked, locked_at = now();
            """, connection);
        seed.Parameters.AddWithValue("teacher", teacherId);
        seed.Parameters.AddWithValue("teacherCode", "P05-T-" + tag);
        seed.Parameters.AddWithValue("circle", circleId);
        seed.Parameters.AddWithValue("circleCode", "P05-C-" + tag);
        seed.Parameters.AddWithValue("slot", slotId);
        seed.Parameters.AddWithValue("session", sessionId);
        seed.Parameters.AddWithValue("attendance", attendanceId);
        seed.Parameters.AddWithValue("request", requestId);
        seed.Parameters.AddWithValue("reviewer", ReviewerId);
        seed.Parameters.AddWithValue("date", date);
        seed.Parameters.AddWithValue("month", month);
        seed.Parameters.AddWithValue("locked", locked);
        seed.Parameters.AddWithValue("currentStatus", currentStatus);
        seed.Parameters.AddWithValue("currentAmount", currentAmount);
        seed.Parameters.AddWithValue("payload", payload);
        seed.Parameters.AddWithValue("startedAt", new DateTimeOffset(date.ToDateTime(new TimeOnly(10, 0)), TimeSpan.Zero));
        await seed.ExecuteNonQueryAsync();

        return new Fixture(requestId, attendanceId);
    }

    private static async Task<(string Status, int Duration, decimal Amount, string RequestStatus)> ReadStateAsync(
        NpgsqlDataSource dataSource, Fixture fixture)
    {
        await using var connection = await dataSource.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("""
            SELECT ta.status, ta.duration_minutes, ta.payable_amount, r.status
            FROM teacher_attendance ta
            JOIN attendance_requests r ON r.attendance_id = ta.id
            WHERE ta.id = @attendance AND r.id = @request;
            """, connection);
        command.Parameters.AddWithValue("attendance", fixture.AttendanceId);
        command.Parameters.AddWithValue("request", fixture.RequestId);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync(), "fixture row disappeared");
        return (reader.GetString(0), reader.GetInt32(1), reader.GetDecimal(2), reader.GetString(3));
    }
}