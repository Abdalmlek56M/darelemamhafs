using System.Security.Claims;
using Dar.Modules.Teaching;
using Dar.Modules.Teaching.Features.Teacher;
using Microsoft.AspNetCore.Http;
using Npgsql;

namespace Dar.IntegrationTests.Teaching;

/// <summary>
/// Regression test for B3 (zero actual minutes = zero pay): ending a session
/// within the first minute must succeed with 200, store 0 payable minutes and
/// 0 payable amount in both teacher_sessions and teacher_attendance, and never
/// fail with a 500 CHECK-constraint violation.
/// </summary>
public sealed class ZeroMinuteSessionTests
{
    [Fact]
    public async Task End_ZeroActualMinutes_ReturnsOk_AndStoresZeroPay()
    {
        if (string.IsNullOrWhiteSpace(IntegrationDatabase.Require())) return;
        await using var dataSource = NpgsqlDataSource.Create(IntegrationDatabase.Require()!);

        var tag = Guid.NewGuid().ToString("N")[..8];
        var userId = Guid.NewGuid();
        var teacherId = Guid.NewGuid();
        var circleId = Guid.NewGuid();
        var slotId = Guid.NewGuid();
        var sessionId = Guid.NewGuid();
        var sessionDate = new DateOnly(2026, 11, 27);

        await using (var conn = await dataSource.OpenConnectionAsync())
        await using (var cmd = new NpgsqlCommand("""
            INSERT INTO teachers(id, teacher_code, full_name, status, hourly_rate)
            VALUES (@teacher, @teacherCode, 'معلمة اختبار صفر دقيقة', 'active', 60);

            INSERT INTO app_users(id, username, display_name, password_hash, teacher_id)
            VALUES (@user, @username, 'معلمة اختبار صفر دقيقة', 'not-a-real-hash', @teacher);

            INSERT INTO circles(id, circle_code, name, teacher_id, monthly_fee, is_active, starts_on)
            VALUES (@circle, @circleCode, 'حلقة اختبار صفر دقيقة', @teacher, 0, TRUE, DATE '2026-01-01');

            INSERT INTO circle_schedule_slots(id, circle_id, day_of_week, starts_at, duration_minutes, is_active)
            VALUES (@slot, @circle, 5, TIME '10:00', 60, TRUE);

            INSERT INTO teacher_sessions(
                id, teacher_id, circle_id, schedule_slot_id, session_date,
                started_at, status, scheduled_duration_minutes, created_by)
            VALUES (
                @session, @teacher, @circle, @slot, @date,
                now(), 'in_progress', 60, @user);
            """, conn))
        {
            cmd.Parameters.AddWithValue("teacher", teacherId);
            cmd.Parameters.AddWithValue("teacherCode", "T0-" + tag);
            cmd.Parameters.AddWithValue("user", userId);
            cmd.Parameters.AddWithValue("username", "t0_user_" + tag);
            cmd.Parameters.AddWithValue("circle", circleId);
            cmd.Parameters.AddWithValue("circleCode", "C0-" + tag);
            cmd.Parameters.AddWithValue("slot", slotId);
            cmd.Parameters.AddWithValue("session", sessionId);
            cmd.Parameters.AddWithValue("date", sessionDate);
            await cmd.ExecuteNonQueryAsync();
        }

        var principal = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
            new Claim("teacher_id", teacherId.ToString()),
            new Claim("display_name", "معلمة اختبار صفر دقيقة"),
            new Claim("permission", "teacher.portal"),
            new Claim("permission", "teacher.attendance"),
            new Claim("permission", "teacher.earnings.self")
        ], "test"));

        var result = await SessionEndpoints.End(
            sessionId,
            new EndSessionRequest("إنهاء فوري"),
            principal,
            dataSource,
            CancellationToken.None);

        Assert.Equal(StatusCodes.Status200OK, (result as IStatusCodeHttpResult)?.StatusCode);

        await using (var conn = await dataSource.OpenConnectionAsync())
        await using (var verify = new NpgsqlCommand("""
            SELECT ts.actual_duration_minutes, ts.payable_duration_minutes, ts.pay_basis,
                   ta.duration_minutes, ta.payable_amount, ta.actual_duration_minutes, ta.pay_basis
            FROM teacher_sessions ts
            JOIN teacher_attendance ta ON ta.teacher_session_id = ts.id
            WHERE ts.id = @session;
            """, conn))
        {
            verify.Parameters.AddWithValue("session", sessionId);
            await using var reader = await verify.ExecuteReaderAsync();
            Assert.True(await reader.ReadAsync());
            Assert.Equal(0, reader.GetInt32(0));
            Assert.Equal(0, reader.GetInt32(1));
            Assert.Equal("actual", reader.GetString(2));
            Assert.Equal(0, reader.GetInt32(3));
            Assert.Equal(0m, reader.GetDecimal(4));
            Assert.Equal(0, reader.GetInt32(5));
            Assert.Equal("actual", reader.GetString(6));
        }
    }
}
