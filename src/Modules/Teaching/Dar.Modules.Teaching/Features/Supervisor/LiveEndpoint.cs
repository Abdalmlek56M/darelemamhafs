using System.Security.Claims;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Supervisor;

public static class LiveEndpoint
{
    private sealed record LiveRow(
        Guid SessionId,
        string CircleName,
        string TeacherName,
        DateOnly Date,
        TimeOnly ScheduledStart,
        int ScheduledMinutes,
        DateTimeOffset StartedAt,
        DateTimeOffset? EndedAt,
        string Status,
        int? ActualStored,
        int Overtime,
        int Undertime,
        string? Note,
        long StudentCount,
        Guid? AttendanceId,
        int? PayableMinutes,
        decimal? PayableAmount);

    public static async Task<IResult> Handle(ClaimsPrincipal principal, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        var hasFinance = TeachingPrincipal.Has(principal, "finance.read");
        var date = CairoTime.Today();
        var now = DateTimeOffset.UtcNow;
        var rows = new List<LiveRow>();
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT ts.id, c.name, t.full_name, ts.session_date, ss.starts_at, ts.scheduled_duration_minutes,
                   ts.started_at, ts.ended_at, ts.status, ts.actual_duration_minutes,
                   ts.overtime_minutes, ts.undertime_minutes, ts.note,
                   (SELECT COUNT(*) FROM circle_enrollments ce
                     WHERE ce.circle_id = ts.circle_id AND ce.status='active' AND ce.is_trashed=FALSE),
                   ta.id, ta.duration_minutes, ta.payable_amount
            FROM teacher_sessions ts
            JOIN circles c ON c.id = ts.circle_id
            JOIN teachers t ON t.id = ts.teacher_id
            JOIN circle_schedule_slots ss ON ss.id = ts.schedule_slot_id
            LEFT JOIN teacher_attendance ta ON ta.teacher_session_id = ts.id AND ta.is_trashed = FALSE
            WHERE ts.session_date = @date AND ts.status IN ('in_progress', 'awaiting_attendance')
            ORDER BY ts.started_at;
            """, connection);
        command.Parameters.AddWithValue("date", date);
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                rows.Add(new LiveRow(
                    reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetFieldValue<DateOnly>(3),
                    reader.GetFieldValue<TimeOnly>(4), reader.GetInt32(5), reader.GetFieldValue<DateTimeOffset>(6),
                    reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7), reader.GetString(8),
                    reader.IsDBNull(9) ? null : reader.GetInt32(9), reader.GetInt32(10), reader.GetInt32(11),
                    reader.IsDBNull(12) ? null : reader.GetString(12), reader.GetInt64(13),
                    reader.IsDBNull(14) ? null : reader.GetGuid(14),
                    reader.IsDBNull(15) ? null : reader.GetInt32(15),
                    reader.IsDBNull(16) ? null : reader.GetDecimal(16)));
            }
        }

        var sessions = rows.Select(row =>
        {
            var actual = row.ActualStored ?? Math.Max(0, (int)Math.Floor((now - row.StartedAt).TotalMinutes));
            var late = Math.Max(0, (int)(CairoTime.ToLocalTime(row.StartedAt).ToTimeSpan() - row.ScheduledStart.ToTimeSpan()).TotalMinutes);
            return new
            {
                sessionId = row.SessionId,
                circleName = row.CircleName,
                teacherName = row.TeacherName,
                date = row.Date,
                scheduledStart = row.ScheduledStart.ToString("HH:mm"),
                scheduledMinutes = row.ScheduledMinutes,
                startedAt = row.StartedAt,
                endedAt = row.EndedAt,
                status = row.Status,
                actualMinutes = actual,
                lateMinutes = late,
                overtimeMinutes = row.Overtime,
                undertimeMinutes = row.Undertime,
                note = row.Note,
                studentCount = row.StudentCount,
                attendanceId = row.AttendanceId,
                payableMinutes = row.PayableMinutes,
                payableAmount = hasFinance ? row.PayableAmount : (decimal?)null
            };
        }).ToArray();

        return Results.Ok(new { now = CairoTime.Now(), date, sessions });
    }
}
