using System.Security.Claims;
using Dar.Modules.Teaching.Features.Requests;
using Microsoft.AspNetCore.Http;
using Npgsql;

namespace Dar.IntegrationTests.Payroll;

/// <summary>
/// B13 regression test: approving an absence request for a slot+date that already
/// has a completed session must be rejected (409) without altering attendance or pay,
/// leaving the request pending so the supervisor can reject it. Absence approval when
/// no completed session exists must continue to apply normally.
/// </summary>
public sealed class AbsenceCompletedSessionTests
{
    private static readonly Guid ReviewerId = Guid.Parse("7b000000-0000-4000-8000-00000000b131");

    private sealed record Fixture(Guid RequestId, Guid SlotId, DateOnly Date, Guid? AttendanceId);

    [Fact]
    public async Task Approve_Absence_OnCompletedSession_ReturnsConflict_AndDoesNotChangePay_AndAllowsReject()
    {
        if (string.IsNullOrWhiteSpace(IntegrationDatabase.Require())) return;
        await using var dataSource = NpgsqlDataSource.Create(IntegrationDatabase.Require()!);
        var fixture = await SeedAbsenceAsync(dataSource, "b13-completed", new DateOnly(2026, 12, 10), withCompletedSession: true);

        var approveResult = await SupervisorRequestEndpoints.Review(
            fixture.RequestId,
            new ReviewRequestRequest(true, "اعتماد غياب"),
            Principal(),
            dataSource,
            CancellationToken.None);

        Assert.Equal(StatusCodes.Status409Conflict, (approveResult as IStatusCodeHttpResult)?.StatusCode);

        var (attendanceStatus, payableAmount, requestStatus) = await ReadStateAsync(dataSource, fixture);
        Assert.Equal("present", attendanceStatus);
        Assert.Equal(60m, payableAmount);
        Assert.Equal("pending", requestStatus);

        var rejectResult = await SupervisorRequestEndpoints.Review(
            fixture.RequestId,
            new ReviewRequestRequest(false, "الحلقة مسجلة ومكتملة"),
            Principal(),
            dataSource,
            CancellationToken.None);

        Assert.Equal(StatusCodes.Status200OK, (rejectResult as IStatusCodeHttpResult)?.StatusCode);
        var (_, _, afterRejectStatus) = await ReadStateAsync(dataSource, fixture);
        Assert.Equal("rejected", afterRejectStatus);
    }

    [Fact]
    public async Task Approve_Absence_WithoutCompletedSession_StillApplies()
    {
        if (string.IsNullOrWhiteSpace(IntegrationDatabase.Require())) return;
        await using var dataSource = NpgsqlDataSource.Create(IntegrationDatabase.Require()!);
        var fixture = await SeedAbsenceAsync(dataSource, "b13-nosession", new DateOnly(2026, 12, 11), withCompletedSession: false);

        var approveResult = await SupervisorRequestEndpoints.Review(
            fixture.RequestId,
            new ReviewRequestRequest(true, "اعتماد غياب"),
            Principal(),
            dataSource,
            CancellationToken.None);

        Assert.Equal(StatusCodes.Status200OK, (approveResult as IStatusCodeHttpResult)?.StatusCode);

        var (attendanceStatus, payableAmount, requestStatus) = await ReadStateAsync(dataSource, fixture);
        Assert.Equal("absent", attendanceStatus);
        Assert.Equal(0m, payableAmount);
        Assert.Equal("approved", requestStatus);
    }

    private static ClaimsPrincipal Principal() => new(new ClaimsIdentity(
    [
        new Claim(ClaimTypes.NameIdentifier, ReviewerId.ToString()),
        new Claim("display_name", "مشرفة اختبار B13"),
        new Claim("permission", "users.manage")
    ], "test"));

    private static async Task<Fixture> SeedAbsenceAsync(
        NpgsqlDataSource dataSource,
        string tagPrefix,
        DateOnly date,
        bool withCompletedSession)
    {
        var tag = tagPrefix + "-" + Guid.NewGuid().ToString("N")[..8];
        var teacherId = Guid.NewGuid();
        var circleId = Guid.NewGuid();
        var slotId = Guid.NewGuid();
        var requestId = Guid.NewGuid();
        Guid? attendanceId = withCompletedSession ? Guid.NewGuid() : null;

        await using var connection = await dataSource.OpenConnectionAsync();
        await using (var user = new NpgsqlCommand("""
            INSERT INTO app_users(id, username, display_name, password_hash)
            VALUES (@id, @username, 'مشرفة اختبار B13', 'not-a-real-hash')
            ON CONFLICT (id) DO NOTHING;
            """, connection))
        {
            user.Parameters.AddWithValue("id", ReviewerId);
            user.Parameters.AddWithValue("username", "b13_reviewer_" + tag);
            await user.ExecuteNonQueryAsync();
        }

        await using (var seed = new NpgsqlCommand("""
            INSERT INTO teachers(id, teacher_code, full_name, status, hourly_rate)
            VALUES (@teacher, @teacherCode, 'معلمة اختبار B13', 'active', 60);

            INSERT INTO circles(id, circle_code, name, teacher_id, monthly_fee, is_active, starts_on)
            VALUES (@circle, @circleCode, 'حلقة اختبار B13', @teacher, 0, TRUE, DATE '2026-01-01');

            INSERT INTO circle_schedule_slots(id, circle_id, day_of_week, starts_at, duration_minutes, is_active)
            VALUES (@slot, @circle, @dow, TIME '10:00', 60, TRUE);

            INSERT INTO attendance_requests(
                id, request_type, teacher_id, circle_id, schedule_slot_id,
                request_date, reason, status, requested_by, requested_payload)
            VALUES (
                @request, 'absence', @teacher, @circle, @slot,
                @date, 'عذر غياب اختبار B13', 'pending', @reviewer, '{}'::jsonb);
            """, connection))
        {
            seed.Parameters.AddWithValue("teacher", teacherId);
            seed.Parameters.AddWithValue("teacherCode", "TB13-" + tag);
            seed.Parameters.AddWithValue("circle", circleId);
            seed.Parameters.AddWithValue("circleCode", "CB13-" + tag);
            seed.Parameters.AddWithValue("slot", slotId);
            seed.Parameters.AddWithValue("dow", (short)date.DayOfWeek);
            seed.Parameters.AddWithValue("request", requestId);
            seed.Parameters.AddWithValue("date", date);
            seed.Parameters.AddWithValue("reviewer", ReviewerId);
            await seed.ExecuteNonQueryAsync();
        }

        if (withCompletedSession)
        {
            var sessionId = Guid.NewGuid();
            await using var completed = new NpgsqlCommand("""
                INSERT INTO teacher_sessions(
                    id, teacher_id, circle_id, schedule_slot_id, session_date,
                    started_at, ended_at, status, scheduled_duration_minutes,
                    actual_duration_minutes, payable_duration_minutes, pay_basis)
                VALUES (
                    @session, @teacher, @circle, @slot, @date,
                    now() - INTERVAL '70 minutes', now() - INTERVAL '10 minutes',
                    'completed', 60, 60, 60, 'scheduled');

                INSERT INTO teacher_attendance(
                    id, schedule_slot_id, circle_id, teacher_id, session_date, scheduled_start,
                    duration_minutes, status, hourly_rate_snapshot, payable_amount,
                    marked_by, teacher_session_id, actual_duration_minutes, pay_basis)
                VALUES (
                    @attendance, @slot, @circle, @teacher, @date, TIME '10:00',
                    60, 'present', 60, 60, @reviewer, @session, 60, 'scheduled');
                """, connection);
            completed.Parameters.AddWithValue("session", sessionId);
            completed.Parameters.AddWithValue("attendance", attendanceId!.Value);
            completed.Parameters.AddWithValue("teacher", teacherId);
            completed.Parameters.AddWithValue("circle", circleId);
            completed.Parameters.AddWithValue("slot", slotId);
            completed.Parameters.AddWithValue("date", date);
            completed.Parameters.AddWithValue("reviewer", ReviewerId);
            await completed.ExecuteNonQueryAsync();
        }

        return new Fixture(requestId, slotId, date, attendanceId);
    }

    private static async Task<(string? AttendanceStatus, decimal? PayableAmount, string RequestStatus)> ReadStateAsync(
        NpgsqlDataSource dataSource,
        Fixture fixture)
    {
        await using var connection = await dataSource.OpenConnectionAsync();
        string? attendanceStatus = null;
        decimal? payableAmount = null;

        await using (var att = new NpgsqlCommand("""
            SELECT status, payable_amount
            FROM teacher_attendance
            WHERE schedule_slot_id = @slot AND session_date = @date AND is_trashed = FALSE
            LIMIT 1;
            """, connection))
        {
            att.Parameters.AddWithValue("slot", fixture.SlotId);
            att.Parameters.AddWithValue("date", fixture.Date);
            await using var reader = await att.ExecuteReaderAsync();
            if (await reader.ReadAsync())
            {
                attendanceStatus = reader.GetString(0);
                payableAmount = reader.GetDecimal(1);
            }
        }

        await using var req = new NpgsqlCommand(
            "SELECT status FROM attendance_requests WHERE id = @id;", connection);
        req.Parameters.AddWithValue("id", fixture.RequestId);
        var requestStatus = (string)(await req.ExecuteScalarAsync())!;
        return (attendanceStatus, payableAmount, requestStatus);
    }
}
