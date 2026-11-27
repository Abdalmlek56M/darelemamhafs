using Dar.Common.Pagination;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    /// <summary>
    /// Tier 2.7 set-based session summary. The old shape grouped sessions x enrollments into
    /// four BOOL_OR aggregates to then FILTER-count them. This shape materialises only the
    /// students that actually count toward a session (roster/eligible/saved attendance union)
    /// and counts present students with one aggregate, which removes the wide GROUP BY while
    /// keeping every count identical (old vs new compared in tests/regression/tier2-queries).
    /// </summary>
    private const string LegacySessionSummarySql = """
        WITH month_days AS (
            SELECT day_value::date AS session_date
            FROM generate_series(@from::date::timestamp, (@to::date - 1)::timestamp,
                                 interval '1 day') AS day_value
        ),
        sessions AS (
            SELECT ss.id AS slot_id, ss.circle_id, d.session_date
            FROM month_days d
            JOIN circle_schedule_slots ss ON ss.day_of_week=EXTRACT(DOW FROM d.session_date)::smallint
            JOIN circles c ON c.id=ss.circle_id AND c.is_trashed=FALSE
            WHERE ss.is_active=TRUE AND ss.is_trashed=FALSE
            UNION
            SELECT ta.schedule_slot_id, ta.circle_id, ta.session_date
            FROM teacher_attendance ta
            JOIN circle_schedule_slots ss ON ss.id=ta.schedule_slot_id AND ss.is_trashed=FALSE
            WHERE ta.is_trashed=FALSE AND ta.schedule_slot_id IS NOT NULL
              AND ta.session_date>=@from AND ta.session_date<@to
            UNION
            SELECT sa.schedule_slot_id, ce.circle_id, sa.session_date
            FROM student_attendance sa
            JOIN circle_schedule_slots ss ON ss.id=sa.schedule_slot_id AND ss.is_trashed=FALSE
            JOIN circle_enrollments ce ON ce.id=sa.enrollment_id AND ce.is_trashed=FALSE
            WHERE sa.is_trashed=FALSE AND sa.session_date>=@from AND sa.session_date<@to
        ),
        counted_students AS (
            -- A student counts for a session when any live enrolment in the session circle is on
            -- the current roster, or is eligible on that date, or already has saved attendance.
            SELECT ses.slot_id, ses.session_date, ce.student_id
            FROM sessions ses
            JOIN circles session_circle ON session_circle.id=ses.circle_id AND session_circle.is_trashed=FALSE
            JOIN circle_enrollments ce ON ce.circle_id=ses.circle_id AND ce.is_trashed=FALSE
            JOIN students s ON s.id=ce.student_id AND s.is_trashed=FALSE
            WHERE (ce.status='active' AND (ce.ends_on IS NULL OR ce.ends_on>=CURRENT_DATE)
                   AND session_circle.starts_on<=CURRENT_DATE)
               OR (ce.starts_on<=ses.session_date
                   AND (ce.ends_on IS NULL OR ce.ends_on>=ses.session_date)
                   AND session_circle.starts_on<=ses.session_date
                   AND public.dar_enrollment_is_attendance_eligible_on_date(ce.id,ses.session_date))
            UNION
            SELECT ses.slot_id, ses.session_date, ce.student_id
            FROM sessions ses
            JOIN circles session_circle ON session_circle.id=ses.circle_id AND session_circle.is_trashed=FALSE
            JOIN student_attendance sa ON sa.schedule_slot_id=ses.slot_id AND sa.session_date=ses.session_date
              AND sa.is_trashed=FALSE
            JOIN circle_enrollments ce ON ce.id=sa.enrollment_id AND ce.circle_id=ses.circle_id AND ce.is_trashed=FALSE
            JOIN students s ON s.id=ce.student_id AND s.is_trashed=FALSE
        ),
        totals AS (
            SELECT slot_id, session_date, COUNT(*) AS total_students
            FROM counted_students GROUP BY slot_id, session_date
        ),
        presents AS (
            SELECT ses.slot_id, ses.session_date, COUNT(DISTINCT ce.student_id) AS present_students
            FROM sessions ses
            JOIN circles session_circle ON session_circle.id=ses.circle_id AND session_circle.is_trashed=FALSE
            JOIN student_attendance sa ON sa.schedule_slot_id=ses.slot_id AND sa.session_date=ses.session_date
              AND sa.is_trashed=FALSE AND sa.status='present'
            JOIN circle_enrollments ce ON ce.id=sa.enrollment_id AND ce.circle_id=ses.circle_id AND ce.is_trashed=FALSE
            JOIN students s ON s.id=ce.student_id AND s.is_trashed=FALSE
            GROUP BY ses.slot_id, ses.session_date
        )
        SELECT ses.slot_id,ses.session_date,COALESCE(totals.total_students,0),
               COALESCE(presents.present_students,0),COUNT(*) OVER() AS total
        FROM sessions ses
        LEFT JOIN totals ON totals.slot_id=ses.slot_id AND totals.session_date=ses.session_date
        LEFT JOIN presents ON presents.slot_id=ses.slot_id AND presents.session_date=ses.session_date
        ORDER BY ses.session_date DESC,ses.slot_id
        LIMIT @take OFFSET @skip
        """;

    internal static async Task<IResult> LoadLegacySessionSummaryAsync(
        string? month, int? page, int? pageSize, HttpContext http,
        NpgsqlDataSource db, CancellationToken ct)
    {
        if (!TryMonth(month, out var from))
            return Results.ValidationProblem(
                new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
        var paging = LegacyPaging(page, pageSize, out var paged);
        await using var command = db.CreateCommand(LegacySessionSummarySql);
        command.Parameters.AddWithValue("from", from);
        command.Parameters.AddWithValue("to", from.AddMonths(1));
        // A NULL LIMIT is "LIMIT ALL", so the unpaged response stays identical.
        command.Parameters.Add(new NpgsqlParameter("take", NpgsqlDbType.Bigint)
            { Value = paged ? paging.PageSize : DBNull.Value });
        command.Parameters.Add(new NpgsqlParameter("skip", NpgsqlDbType.Bigint)
            { Value = paged ? paging.Offset : 0L });
        var rows = new List<object>();
        long total = 0;
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            total = reader.ReadTotal();
            rows.Add(new
            {
                scheduleSlotId = reader.GetGuid(0),
                sessionDate = reader.GetFieldValue<DateOnly>(1),
                totalStudents = reader.GetInt64(2),
                presentStudents = reader.GetInt64(3)
            });
        }
        await reader.DisposeAsync();
        total = await LegacyTotalAsync(command, total, paged, ct);
        LegacyHeaders(http, total, paging, rows.Count, paged);
        return Results.Ok(rows);
    }
}
