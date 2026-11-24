using System.Security.Claims;
using Dar.Modules.Teaching.Features.Requests;
using Microsoft.AspNetCore.Http;
using Npgsql;

namespace Dar.IntegrationTests.Payroll;

/// <summary>
/// P0-3 regression test: approving a correction request whose optional note is absent, null or
/// empty must succeed (it used to fail with PostgreSQL 42P08 -> HTTP 500 because btrim(@note)
/// received an untyped DBNull parameter).
/// Requires DAR_TEST_DATABASE pointing at a disposable database with the production schema.
/// </summary>
public sealed class ReviewOptionalNoteTests
{
    private const string EnvName = "DAR_TEST_DATABASE";
    private static readonly Guid ReviewerId = Guid.Parse("7c000000-0000-4000-8000-00000000d001");

    private sealed record Fixture(Guid RequestId, Guid AttendanceId);

    [Fact]
    public async Task Review_Correction_WithAbsentNullOrEmptyNote_AllSucceed()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(EnvName))) return;
        await using var dataSource = NpgsqlDataSource.Create(Environment.GetEnvironmentVariable(EnvName)!);

        var cases = new (string Tag, string Payload, int ExpectedMinutes, decimal ExpectedAmount)[]
        {
            ("absent", "{\"durationMinutes\":30}", 30, 30m),
            ("null", "{\"durationMinutes\":20,\"note\":null}", 20, 20m),
            ("empty", "{\"durationMinutes\":25,\"note\":\"\"}", 25, 25m)
        };

        foreach (var item in cases)
        {
            var fixture = await SeedCorrectionAsync(dataSource, item.Tag, item.Payload);
            var result = await SupervisorRequestEndpoints.Review(fixture.RequestId,
                new ReviewRequestRequest(true, null), Principal(), dataSource, CancellationToken.None);
            Assert.Equal(StatusCodes.Status200OK, (result as IStatusCodeHttpResult)?.StatusCode);

            var (duration, amount, status) = await ReadStateAsync(dataSource, fixture);
            Assert.Equal(item.ExpectedMinutes, duration);
            Assert.Equal(item.ExpectedAmount, amount);
            Assert.Equal("approved", status);
        }
    }

    private static ClaimsPrincipal Principal() => new(new ClaimsIdentity(
    [
        new Claim(ClaimTypes.NameIdentifier, ReviewerId.ToString()),
        new Claim("display_name", "مراجع اختبار P0-3"),
        new Claim("permission", "users.manage")
    ], "test"));

    private static async Task<Fixture> SeedCorrectionAsync(NpgsqlDataSource dataSource, string tagPrefix, string payloadJson)
    {
        var tag = tagPrefix + "-" + Guid.NewGuid().ToString("N")[..8];
        var teacherId = Guid.NewGuid();
        var circleId = Guid.NewGuid();
        var slotId = Guid.NewGuid();
        var sessionId = Guid.NewGuid();
        var attendanceId = Guid.NewGuid();
        var requestId = Guid.NewGuid();
        var date = new DateOnly(2026, 12, 7);

        await using var connection = await dataSource.OpenConnectionAsync();
        await using (var user = new NpgsqlCommand("""
            INSERT INTO app_users(id, username, display_name, password_hash)
            VALUES (@id, 'p03_reviewer_' || @tag, 'مراجع اختبار P0-3', 'not-a-real-hash')
            ON CONFLICT (id) DO NOTHING;
            """, connection))
        {
            user.Parameters.AddWithValue("id", ReviewerId);
            user.Parameters.AddWithValue("tag", tag);
            await user.ExecuteNonQueryAsync();
        }

        await using var seed = new NpgsqlCommand("""
            INSERT INTO teachers(id, teacher_code, full_name, status, hourly_rate)
            VALUES (@teacher, @teacherCode, 'معلمة اختبار الملاحظة', 'active', 60);

            INSERT INTO circles(id, circle_code, name, teacher_id, monthly_fee, is_active, starts_on)
            VALUES (@circle, @circleCode, 'حلقة اختبار الملاحظة', @teacher, 0, TRUE, DATE '2026-01-01');

            INSERT INTO circle_schedule_slots(id, circle_id, day_of_week, starts_at, duration_minutes)
            VALUES (@slot, @circle, 1, TIME '10:00', 60);

            INSERT INTO teacher_sessions(id, teacher_id, circle_id, schedule_slot_id, session_date, started_at, ended_at,
                                         status, scheduled_duration_minutes, actual_duration_minutes, payable_duration_minutes, pay_basis, note)
            VALUES (@session, @teacher, @circle, @slot, @date, @startedAt, @startedAt + INTERVAL '60 minutes',
                    'completed', 60, 60, 60, 'actual', 'ملاحظة أصلية');

            INSERT INTO teacher_attendance(id, schedule_slot_id, circle_id, teacher_id, session_date, scheduled_start,
                                           duration_minutes, status, hourly_rate_snapshot, payable_amount, note, marked_by,
                                           teacher_session_id, actual_duration_minutes, pay_basis)
            VALUES (@attendance, @slot, @circle, @teacher, @date, TIME '10:00',
                    60, 'present', 60, 60, 'ملاحظة أصلية', @reviewer, @session, 60, 'actual');

            INSERT INTO attendance_requests(id, request_type, teacher_id, circle_id, schedule_slot_id, attendance_id,
                                            request_date, requested_by, reason, requested_payload, status)
            VALUES (@request, 'correction', @teacher, @circle, @slot, @attendance,
                    @date, @reviewer, 'طلب تصحيح اختبار الملاحظة', @payload::jsonb, 'pending');
            """, connection);
        seed.Parameters.AddWithValue("teacher", teacherId);
        seed.Parameters.AddWithValue("teacherCode", "P03-T-" + tag);
        seed.Parameters.AddWithValue("circle", circleId);
        seed.Parameters.AddWithValue("circleCode", "P03-C-" + tag);
        seed.Parameters.AddWithValue("slot", slotId);
        seed.Parameters.AddWithValue("session", sessionId);
        seed.Parameters.AddWithValue("attendance", attendanceId);
        seed.Parameters.AddWithValue("request", requestId);
        seed.Parameters.AddWithValue("reviewer", ReviewerId);
        seed.Parameters.AddWithValue("date", date);
        seed.Parameters.AddWithValue("payload", payloadJson);
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
