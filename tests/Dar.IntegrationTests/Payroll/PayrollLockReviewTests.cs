using System.Security.Claims;
using Dar.Modules.Teaching.Features.Requests;
using Microsoft.AspNetCore.Http;
using Npgsql;

namespace Dar.IntegrationTests.Payroll;

/// <summary>
/// P0-1 regression test: approving a correction request changes a teacher's payable amount,
/// so it must be blocked by the payroll lock exactly like a direct attendance adjustment.
/// Requires DAR_TEST_DATABASE = connection string to a disposable PostgreSQL database that
/// already contains the production schema (the caller prepares it; tests seed their own rows).
/// </summary>
public sealed class PayrollLockReviewTests
{
    private const string EnvName = "DAR_TEST_DATABASE";
    private static readonly Guid ReviewerId = Guid.Parse("7b000000-0000-4000-8000-00000000c001");

    private sealed record Fixture(Guid RequestId, Guid AttendanceId);

    [Fact]
    public async Task Review_Correction_OnLockedMonth_ReturnsConflict_AndDoesNotChangePay()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(EnvName))) return;
        await using var dataSource = NpgsqlDataSource.Create(Environment.GetEnvironmentVariable(EnvName)!);
        var fixture = await SeedCorrectionAsync(dataSource, "locked", new DateOnly(2026, 10, 5), locked: true);

        var result = await SupervisorRequestEndpoints.Review(fixture.RequestId,
            new ReviewRequestRequest(true, "اختبار P0: اعتماد داخل شهر مقفول"),
            Principal(), dataSource, CancellationToken.None);

        Assert.Equal(StatusCodes.Status409Conflict, (result as IStatusCodeHttpResult)?.StatusCode);
        var (duration, amount, requestStatus) = await ReadStateAsync(dataSource, fixture);
        Assert.Equal(60, duration);
        Assert.Equal(60m, amount);
        Assert.Equal("pending", requestStatus);
    }

    [Fact]
    public async Task Review_Correction_OnUnlockedMonth_StillApplies()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(EnvName))) return;
        await using var dataSource = NpgsqlDataSource.Create(Environment.GetEnvironmentVariable(EnvName)!);
        var fixture = await SeedCorrectionAsync(dataSource, "unlocked", new DateOnly(2026, 12, 5), locked: false);

        var result = await SupervisorRequestEndpoints.Review(fixture.RequestId,
            new ReviewRequestRequest(true, "اختبار P0: اعتماد في شهر مفتوح"),
            Principal(), dataSource, CancellationToken.None);

        Assert.Equal(StatusCodes.Status200OK, (result as IStatusCodeHttpResult)?.StatusCode);
        var (duration, amount, requestStatus) = await ReadStateAsync(dataSource, fixture);
        Assert.Equal(30, duration);
        Assert.Equal(30m, amount);
        Assert.Equal("approved", requestStatus);
    }

    private static ClaimsPrincipal Principal() => new(new ClaimsIdentity(
    [
        new Claim(ClaimTypes.NameIdentifier, ReviewerId.ToString()),
        new Claim("display_name", "مراجع اختبار P0"),
        new Claim("permission", "users.manage")
    ], "test"));

    private static async Task<Fixture> SeedCorrectionAsync(NpgsqlDataSource dataSource, string tagPrefix, DateOnly date, bool locked)
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
            VALUES (@id, @username, 'مراجع اختبار P0', 'not-a-real-hash')
            ON CONFLICT (id) DO NOTHING;
            """, connection))
        {
            user.Parameters.AddWithValue("id", ReviewerId);
            user.Parameters.AddWithValue("username", "p0_reviewer_" + tag);
            await user.ExecuteNonQueryAsync();
        }

        await using var seed = new NpgsqlCommand("""
            INSERT INTO teachers(id, teacher_code, full_name, status, hourly_rate)
            VALUES (@teacher, @teacherCode, 'معلمة اختبار القفل', 'active', 60);

            INSERT INTO circles(id, circle_code, name, teacher_id, monthly_fee, is_active, starts_on)
            VALUES (@circle, @circleCode, 'حلقة اختبار القفل', @teacher, 0, TRUE, DATE '2026-01-01');

            INSERT INTO circle_schedule_slots(id, circle_id, day_of_week, starts_at, duration_minutes)
            VALUES (@slot, @circle, 0, TIME '10:00', 60);

            INSERT INTO teacher_sessions(id, teacher_id, circle_id, schedule_slot_id, session_date, started_at, ended_at,
                                         status, scheduled_duration_minutes, actual_duration_minutes, payable_duration_minutes, pay_basis)
            VALUES (@session, @teacher, @circle, @slot, @date, @startedAt, @startedAt + INTERVAL '60 minutes',
                    'completed', 60, 60, 60, 'actual');

            INSERT INTO teacher_attendance(id, schedule_slot_id, circle_id, teacher_id, session_date, scheduled_start,
                                           duration_minutes, status, hourly_rate_snapshot, payable_amount, marked_by,
                                           teacher_session_id, actual_duration_minutes, pay_basis)
            VALUES (@attendance, @slot, @circle, @teacher, @date, TIME '10:00',
                    60, 'present', 60, 60, @reviewer, @session, 60, 'actual');

            INSERT INTO attendance_requests(id, request_type, teacher_id, circle_id, schedule_slot_id, attendance_id,
                                            request_date, requested_by, reason, requested_payload, status)
            VALUES (@request, 'correction', @teacher, @circle, @slot, @attendance,
                    @date, @reviewer, 'طلب تصحيح اختبار القفل', '{"durationMinutes":30,"note":"مراجعة اختبار"}'::jsonb, 'pending');

            INSERT INTO payroll_locks(billing_month, is_locked, locked_by, locked_at)
            VALUES (@month, @locked, @reviewer, now())
            ON CONFLICT (billing_month) DO UPDATE SET is_locked = EXCLUDED.is_locked, locked_at = now();
            """, connection);
        seed.Parameters.AddWithValue("teacher", teacherId);
        seed.Parameters.AddWithValue("teacherCode", "P0-T-" + tag);
        seed.Parameters.AddWithValue("circle", circleId);
        seed.Parameters.AddWithValue("circleCode", "P0-C-" + tag);
        seed.Parameters.AddWithValue("slot", slotId);
        seed.Parameters.AddWithValue("session", sessionId);
        seed.Parameters.AddWithValue("attendance", attendanceId);
        seed.Parameters.AddWithValue("request", requestId);
        seed.Parameters.AddWithValue("reviewer", ReviewerId);
        seed.Parameters.AddWithValue("date", date);
        seed.Parameters.AddWithValue("month", month);
        seed.Parameters.AddWithValue("locked", locked);
        seed.Parameters.AddWithValue("startedAt", new DateTimeOffset(date.ToDateTime(new TimeOnly(10, 0)), TimeSpan.Zero));
        await seed.ExecuteNonQueryAsync();

        return new Fixture(requestId, attendanceId);
    }

    private static async Task<(int Duration, decimal Amount, string Status)> ReadStateAsync(NpgsqlDataSource dataSource, Fixture fixture)
    {
        await using var connection = await dataSource.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("""
            SELECT ta.duration_minutes, ta.payable_amount, r.status
            FROM teacher_attendance ta
            JOIN attendance_requests r ON r.attendance_id = ta.id
            WHERE ta.id = @attendance AND r.id = @request;
            """, connection);
        command.Parameters.AddWithValue("attendance", fixture.AttendanceId);
        command.Parameters.AddWithValue("request", fixture.RequestId);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync(), "fixture row disappeared");
        return (reader.GetInt32(0), reader.GetDecimal(1), reader.GetString(2));
    }
}