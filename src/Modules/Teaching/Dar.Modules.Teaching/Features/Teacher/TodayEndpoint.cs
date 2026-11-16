using System.Security.Claims;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Teacher;

public static class TodayEndpoint
{
    private sealed record Slot(
        Guid Id,
        Guid CircleId,
        string CircleName,
        TimeOnly StartsAt,
        int DurationMinutes,
        long StudentCount,
        Guid? SessionId,
        string? SessionStatus,
        DateTimeOffset? StartedAt,
        DateTimeOffset? EndedAt,
        int? ActualMinutes,
        int? PayableMinutes,
        string? PayBasis,
        int OvertimeMinutes,
        int UndertimeMinutes,
        string? Note);

    public static async Task<IResult> Handle(
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var teacherId = TeachingPrincipal.TeacherId(principal);
        if (teacherId == Guid.Empty)
            return Results.Json(new { message = "هذا الحساب غير مرتبط بمعلمة. راجع المدير." }, statusCode: StatusCodes.Status403Forbidden);

        var date = CairoTime.Today();
        var now = CairoTime.NowTime();
        var dayOfWeek = (int)date.DayOfWeek;

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT t.full_name, t.hourly_rate,
                   ss.id, ss.circle_id, c.name, ss.starts_at, ss.duration_minutes,
                   (SELECT COUNT(*) FROM circle_enrollments ce
                     WHERE ce.circle_id = c.id AND ce.status = 'active' AND ce.is_trashed = FALSE),
                   ts.id, ts.status, ts.started_at, ts.ended_at,
                   ts.actual_duration_minutes, ts.payable_duration_minutes, ts.pay_basis,
                   ts.overtime_minutes, ts.undertime_minutes, ts.note
            FROM teachers t
            LEFT JOIN circles c ON c.teacher_id = t.id AND c.is_trashed = FALSE AND c.is_active = TRUE
            LEFT JOIN circle_schedule_slots ss ON ss.circle_id = c.id
                 AND ss.is_active = TRUE AND ss.is_trashed = FALSE AND ss.day_of_week = @day
            LEFT JOIN teacher_sessions ts ON ts.schedule_slot_id = ss.id AND ts.session_date = @date
            WHERE t.id = @teacher AND t.is_trashed = FALSE AND t.status = 'active'
            ORDER BY ss.starts_at NULLS LAST;
            """, connection);
        command.Parameters.AddWithValue("teacher", teacherId);
        command.Parameters.AddWithValue("date", date);
        command.Parameters.AddWithValue("day", dayOfWeek);

        string? teacherName = null;
        decimal hourlyRate = 0m;
        var slots = new List<Slot>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                teacherName ??= reader.GetString(0);
                hourlyRate = reader.GetDecimal(1);
                if (reader.IsDBNull(2)) continue;
                slots.Add(new Slot(
                    reader.GetGuid(2), reader.GetGuid(3), reader.GetString(4),
                    reader.GetFieldValue<TimeOnly>(5), reader.GetInt32(6), reader.GetInt64(7),
                    reader.IsDBNull(8) ? null : reader.GetGuid(8),
                    reader.IsDBNull(9) ? null : reader.GetString(9),
                    reader.IsDBNull(10) ? null : reader.GetFieldValue<DateTimeOffset>(10),
                    reader.IsDBNull(11) ? null : reader.GetFieldValue<DateTimeOffset>(11),
                    reader.IsDBNull(12) ? null : reader.GetInt32(12),
                    reader.IsDBNull(13) ? null : reader.GetInt32(13),
                    reader.IsDBNull(14) ? null : reader.GetString(14),
                    reader.IsDBNull(15) ? 0 : reader.GetInt32(15),
                    reader.IsDBNull(16) ? 0 : reader.GetInt32(16),
                    reader.IsDBNull(17) ? null : reader.GetString(17)));
            }
        }

        if (teacherName is null)
            return Results.Json(new { message = "المعلمة غير موجودة أو غير نشطة." }, statusCode: StatusCodes.Status403Forbidden);

        var result = slots.Select(slot =>
        {
            var end = slot.StartsAt.AddMinutes(slot.DurationMinutes);
            var isCurrent = now >= slot.StartsAt && now < end;
            var isNext = slot.StartsAt > now;
            var lateMinutes = slot.StartedAt is { } started
                ? Math.Max(0, (int)(CairoTime.ToLocalTime(started).ToTimeSpan() - slot.StartsAt.ToTimeSpan()).TotalMinutes)
                : 0;
            return new
            {
                id = slot.Id,
                circleId = slot.CircleId,
                circleName = slot.CircleName,
                startsAt = slot.StartsAt.ToString("HH:mm"),
                endsAt = end.ToString("HH:mm"),
                durationMinutes = slot.DurationMinutes,
                studentCount = slot.StudentCount,
                isCurrent,
                isNext,
                minutesUntilStart = isNext ? (int)Math.Ceiling((slot.StartsAt.ToTimeSpan() - now.ToTimeSpan()).TotalMinutes) : (int?)null,
                lateMinutes,
                sessionId = slot.SessionId,
                sessionStatus = slot.SessionStatus,
                startedAt = slot.StartedAt,
                endedAt = slot.EndedAt,
                actualDurationMinutes = slot.ActualMinutes,
                payableDurationMinutes = slot.PayableMinutes,
                payBasis = slot.PayBasis,
                overtimeMinutes = slot.OvertimeMinutes,
                undertimeMinutes = slot.UndertimeMinutes,
                note = slot.Note
            };
        }).ToArray();

        return Results.Ok(new
        {
            teacher = new { id = teacherId, name = teacherName, hourlyRate },
            date,
            dayOfWeek,
            currentSlotId = result.FirstOrDefault(x => x.isCurrent)?.id,
            nextSlotId = result.FirstOrDefault(x => x.isNext)?.id,
            slots = result
        });
    }
}
