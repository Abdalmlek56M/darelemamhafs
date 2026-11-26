using Dar.Common.Pagination;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    internal static async Task<IResult> LoadLegacySessionSummaryAsync(
        string? month, int? page, int? pageSize, HttpContext http,
        NpgsqlDataSource db, CancellationToken ct)
    {
        if (!TryMonth(month, out var from))
            return Results.ValidationProblem(
                new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
        var paging = LegacyPaging(page, pageSize, out var paged);
        var query = """
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
            per_student AS (
                SELECT ses.slot_id,ses.session_date,s.id AS student_id,
                       BOOL_OR(ce.starts_on<=ses.session_date
                         AND (ce.ends_on IS NULL OR ce.ends_on>=ses.session_date)
                         AND session_circle.starts_on<=ses.session_date
                         AND public.dar_enrollment_is_attendance_eligible_on_date(ce.id,ses.session_date))
                         AS eligible_for_date,
                       BOOL_OR(sa.id IS NOT NULL) AS has_saved_attendance,
                       BOOL_OR(sa.status='present') AS is_present,
                       BOOL_OR(ce.status='active' AND (ce.ends_on IS NULL OR ce.ends_on>=CURRENT_DATE)
                         AND session_circle.starts_on<=CURRENT_DATE) AS is_current_roster
                FROM sessions ses
                JOIN circle_enrollments ce ON ce.circle_id=ses.circle_id AND ce.is_trashed=FALSE
                JOIN students s ON s.id=ce.student_id AND s.is_trashed=FALSE
                JOIN circles session_circle ON session_circle.id=ses.circle_id
                  AND session_circle.is_trashed=FALSE
                LEFT JOIN student_attendance sa ON sa.enrollment_id=ce.id
                  AND sa.schedule_slot_id=ses.slot_id AND sa.session_date=ses.session_date
                  AND sa.is_trashed=FALSE
                GROUP BY ses.slot_id,ses.session_date,s.id
            ),
            counts AS (
                SELECT slot_id,session_date,
                       COUNT(DISTINCT student_id)
                         FILTER (WHERE is_current_roster OR eligible_for_date OR has_saved_attendance)
                         AS total_students,
                       COUNT(DISTINCT student_id) FILTER (WHERE is_present) AS present_students
                FROM per_student GROUP BY slot_id,session_date
            )
            SELECT ses.slot_id,ses.session_date,COALESCE(counts.total_students,0),
                   COALESCE(counts.present_students,0),COUNT(*) OVER() AS total
            FROM sessions ses LEFT JOIN counts ON counts.slot_id=ses.slot_id
              AND counts.session_date=ses.session_date
            ORDER BY ses.session_date DESC,ses.slot_id
            """;
        if (paged) query += " LIMIT @take OFFSET @skip";
        await using var command = db.CreateCommand(query);
        command.Parameters.AddWithValue("from", from);
        command.Parameters.AddWithValue("to", from.AddMonths(1));
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
