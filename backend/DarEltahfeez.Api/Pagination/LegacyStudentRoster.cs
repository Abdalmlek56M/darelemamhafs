using Dar.Common.Pagination;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    internal static async Task<IResult> LoadLegacyStudentRosterAsync(
        Guid scheduleSlotId, DateOnly date, int? page, int? pageSize, HttpContext http,
        NpgsqlDataSource db, CancellationToken ct)
    {
        var paging = LegacyPaging(page, pageSize, out var paged);
        var query = """
            WITH candidates AS (
                SELECT ce.id AS enrollment_id, s.id AS student_id, s.student_code, s.full_name,
                       sa.status, sa.note,
                       (ce.starts_on<=@date AND (ce.ends_on IS NULL OR ce.ends_on>=@date)
                         AND attendance_circle.starts_on<=@date
                         AND public.dar_enrollment_is_attendance_eligible_on_date(ce.id,@date)) AS eligible_for_date,
                       CASE
                         WHEN attendance_circle.starts_on>@date THEN 'before-circle-start'
                         WHEN ce.starts_on>@date THEN 'before-enrollment-start'
                         WHEN ce.ends_on IS NOT NULL AND @date>ce.ends_on THEN 'after-enrollment-end'
                         WHEN COALESCE(lifecycle.status_at_date, CASE WHEN ce.ends_on IS NOT NULL
                              AND @date>ce.ends_on THEN 'ended' WHEN ce.status='paused'
                              AND @date>=CURRENT_DATE THEN 'paused' ELSE 'active' END)='paused' THEN 'paused'
                         WHEN NOT public.dar_enrollment_is_attendance_eligible_on_date(ce.id,@date)
                           THEN 'not-active-on-date'
                         ELSE NULL
                       END AS eligibility_reason,
                       ce.starts_on, ce.ends_on,
                       COALESCE(lifecycle.status_at_date, CASE WHEN ce.ends_on IS NOT NULL
                         AND @date>ce.ends_on THEN 'ended' WHEN ce.status='paused'
                         AND @date>=CURRENT_DATE THEN 'paused' ELSE 'active' END) AS enrollment_status_at_date,
                       ROW_NUMBER() OVER (
                         PARTITION BY s.id
                         ORDER BY (sa.id IS NOT NULL) DESC,
                                  (ce.starts_on<=@date AND (ce.ends_on IS NULL OR ce.ends_on>=@date)
                                    AND attendance_circle.starts_on<=@date
                                    AND public.dar_enrollment_is_attendance_eligible_on_date(ce.id,@date)) DESC,
                                  (ce.status='active') DESC, ce.starts_on DESC, ce.created_at DESC, ce.id DESC
                       ) AS student_row
                    FROM circle_schedule_slots ss
                    JOIN circle_enrollments ce ON ce.circle_id=ss.circle_id AND ce.is_trashed=FALSE
                    JOIN circles attendance_circle ON attendance_circle.id=ss.circle_id
                      AND attendance_circle.is_trashed=FALSE
                    JOIN students s ON s.id=ce.student_id AND s.is_trashed=FALSE
                    LEFT JOIN student_attendance sa ON sa.enrollment_id=ce.id AND sa.schedule_slot_id=ss.id
                      AND sa.session_date=@date AND sa.is_trashed=FALSE
                    LEFT JOIN LATERAL (
                        SELECT public.dar_enrollment_status_at_date(ce.id,@date) AS status_at_date
                    ) lifecycle ON TRUE
                    WHERE ss.id=@slot AND ss.is_trashed=FALSE
                )
                SELECT enrollment_id,student_id,student_code,full_name,status,note,eligible_for_date,
                       eligibility_reason,starts_on,ends_on,enrollment_status_at_date,
                       COUNT(*) OVER() AS total
                FROM candidates WHERE student_row=1
                ORDER BY eligible_for_date DESC,full_name,student_id
            """;
        if (paged) query += " LIMIT @take OFFSET @skip";
        await using var command = db.CreateCommand(query);
        command.Parameters.AddWithValue("slot", scheduleSlotId);
        command.Parameters.AddWithValue("date", date);
        if (paged)
        {
            command.Parameters.AddWithValue("take", paging.PageSize);
            command.Parameters.AddWithValue("skip", paging.Offset);
        }
        var rows = new List<object>();
        long total = 0;
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            total = reader.GetInt64(11);
            rows.Add(new
            {
                enrollmentId = reader.GetGuid(0),
                studentId = reader.GetGuid(1),
                studentCode = reader.GetString(2),
                studentName = reader.GetString(3),
                status = reader.IsDBNull(4) ? null : reader.GetString(4),
                note = reader.IsDBNull(5) ? null : reader.GetString(5),
                eligibleForDate = reader.GetBoolean(6),
                eligibilityReason = reader.IsDBNull(7) ? null : reader.GetString(7),
                startsOn = reader.GetFieldValue<DateOnly>(8),
                endsOn = reader.IsDBNull(9) ? (DateOnly?)null : reader.GetFieldValue<DateOnly>(9),
                enrollmentStatus = reader.GetString(10)
            });
        }
        await reader.DisposeAsync();
        total = await LegacyTotalAsync(command, total, 11, paged, ct);
        LegacyHeaders(http, total, paging, rows.Count, paged);
        return Results.Ok(rows);
    }
}
