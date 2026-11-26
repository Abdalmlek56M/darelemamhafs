using System.Security.Claims;
using Npgsql;
using Dar.Common.Domain;
using Dar.Common.Pagination;
using Dar.Modules.Teaching.Features.Shared;
namespace Dar.Modules.Teaching.Features.Supervisor;
public static class StudentsEndpoint
{
    public static async Task<IResult> List(
        string? search,
        Guid? circleId,
        int? page,
        int? pageSize,
        HttpContext http,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);

        if (circleId is not null && !scope.AllowsCircle(circleId.Value))
            return Results.Json(new { message = "هذه الحلقة خارج نطاقك." }, statusCode: StatusCodes.Status403Forbidden);

        var term = (search ?? string.Empty).Trim();
        var like = $"%{term}%";
        var paging = new PageRequest(page, pageSize);
        var paged = page is not null || pageSize is not null;
        var take = paged ? paging.PageSize : 500;

        await using var command = new NpgsqlCommand("""
            SELECT s.id, s.student_code, s.full_name, s.phone, s.guardian_name, s.guardian_phone,
                   s.status, s.joined_on,
                   (SELECT CASE
                       WHEN COUNT(mc.id)=0 THEN 'not-set'
                       WHEN COALESCE(SUM(mc.amount_due),0) <= COALESCE(SUM(p.paid),0) THEN 'paid'
                       WHEN COALESCE(SUM(p.paid),0) > 0 THEN 'partial'
                       ELSE 'unpaid' END
                    FROM circle_enrollments ce2
                    JOIN circles c2 ON c2.id=ce2.circle_id AND c2.is_trashed=FALSE
                    LEFT JOIN monthly_charges mc ON mc.enrollment_id=ce2.id AND mc.billing_month=@month AND mc.is_trashed=FALSE AND mc.voided_at IS NULL
                    LEFT JOIN LATERAL (
                        SELECT SUM(pay.amount) AS paid FROM payments pay
                        WHERE pay.monthly_charge_id=mc.id AND pay.is_trashed=FALSE AND pay.voided_at IS NULL
                    ) p ON TRUE
                    WHERE ce2.student_id=s.id AND ce2.is_trashed=FALSE AND ce2.status IN ('active','paused')
                      AND (@all OR c2.id = ANY(@circles))) AS subscription_status,
                   COALESCE(array_agg(DISTINCT c.name) FILTER (WHERE c.id IS NOT NULL), ARRAY[]::text[]) AS circles,
                   COUNT(*) OVER() AS total
            FROM students s
            JOIN circle_enrollments ce ON ce.student_id = s.id AND ce.is_trashed = FALSE
                 AND ce.status IN ('active', 'paused')
            JOIN circles c ON c.id = ce.circle_id AND c.is_trashed = FALSE
                 AND (@all OR c.id = ANY(@circles))
            WHERE s.is_trashed = FALSE
              AND (@search = '' OR s.full_name ILIKE @like OR s.student_code ILIKE @like
                   OR COALESCE(s.phone, '') ILIKE @like OR COALESCE(s.guardian_phone, '') ILIKE @like)
              AND (@circle::uuid IS NULL OR c.id = @circle)
            GROUP BY s.id
            ORDER BY s.full_name
            LIMIT @take OFFSET @skip;
            """, connection);
        command.Parameters.AddWithValue("all", scope.All);
        command.Parameters.AddWithValue("circles", scope.CircleIds);
        command.Parameters.AddWithValue("search", term);
        command.Parameters.AddWithValue("like", like);
        command.Parameters.AddWithValue("circle", (object?)circleId ?? DBNull.Value);
        var today = CairoTime.Today();
        command.Parameters.AddWithValue("month", new DateOnly(today.Year, today.Month, 1));
        command.Parameters.AddWithValue("take", take);
        command.Parameters.AddWithValue("skip", paged ? paging.Offset : 0L);

        var students = new List<object>();
        long total = 0;
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            total = reader.GetInt64(10);
            students.Add(new
            {
                id = reader.GetGuid(0),
                studentCode = reader.GetString(1),
                fullName = reader.GetString(2),
                phone = reader.IsDBNull(3) ? null : reader.GetString(3),
                guardianName = reader.IsDBNull(4) ? null : reader.GetString(4),
                guardianPhone = reader.IsDBNull(5) ? null : reader.GetString(5),
                status = reader.GetString(6),
                joinedOn = reader.GetFieldValue<DateOnly>(7),
                subscriptionStatus = reader.GetString(8),
                circles = reader.GetFieldValue<string[]>(9)
            });
        }

        await reader.DisposeAsync();

        total = await PaginationHeaders.EnsureTotalAsync(command, total, 10, paged, ct);
        PaginationHeaders.Apply(http.Response, total, paging, students.Count, paged);
        return Results.Ok(new { count = students.Count, students });
    }

    public static async Task<IResult> Detail(
        Guid id,
        DateOnly? from,
        DateOnly? to,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var today = CairoTime.Today();
        var start = from ?? today.AddDays(-90);
        var end = to ?? today;
        if (end < start || end.DayNumber - start.DayNumber > 366)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["date"] = ["اختر فترة صحيحة لا تتجاوز سنة."] });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);

        Guid studentId;
        string code, name, status;
        string? phone, guardianName, guardianPhone, generalNotes;
        DateOnly joinedOn;

        await using (var student = new NpgsqlCommand("""
            SELECT s.id, s.student_code, s.full_name, s.phone, s.guardian_name, s.guardian_phone,
                   s.status, s.joined_on, s.notes
            FROM students s
            WHERE s.id = @id AND s.is_trashed = FALSE
              AND EXISTS (
                  SELECT 1
                  FROM circle_enrollments ce
                  JOIN circles c ON c.id = ce.circle_id AND c.is_trashed = FALSE
                  WHERE ce.student_id = s.id AND ce.is_trashed = FALSE
                    AND (@all OR c.id = ANY(@circles))
              );
            """, connection))
        {
            student.Parameters.AddWithValue("id", id);
            student.Parameters.AddWithValue("all", scope.All);
            student.Parameters.AddWithValue("circles", scope.CircleIds);
            await using var reader = await student.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
                return Results.NotFound(new { message = "الطالبة غير موجودة داخل نطاقك." });

            studentId = reader.GetGuid(0);
            code = reader.GetString(1);
            name = reader.GetString(2);
            phone = reader.IsDBNull(3) ? null : reader.GetString(3);
            guardianName = reader.IsDBNull(4) ? null : reader.GetString(4);
            guardianPhone = reader.IsDBNull(5) ? null : reader.GetString(5);
            status = reader.GetString(6);
            joinedOn = reader.GetFieldValue<DateOnly>(7);
            generalNotes = reader.IsDBNull(8) ? null : reader.GetString(8);
        }

        var circles = new List<object>();
        await using (var circleCommand = new NpgsqlCommand("""
            SELECT DISTINCT c.id, c.name
            FROM circle_enrollments ce
            JOIN circles c ON c.id = ce.circle_id AND c.is_trashed = FALSE
            WHERE ce.student_id = @id AND ce.is_trashed = FALSE
              AND (@all OR c.id = ANY(@circles))
            ORDER BY c.name;
            """, connection))
        {
            circleCommand.Parameters.AddWithValue("id", id);
            circleCommand.Parameters.AddWithValue("all", scope.All);
            circleCommand.Parameters.AddWithValue("circles", scope.CircleIds);
            await using var reader = await circleCommand.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                circles.Add(new { id = reader.GetGuid(0), name = reader.GetString(1) });
        }

        int present, absent, excused, marked;
        await using (var summary = new NpgsqlCommand("""
            SELECT COUNT(*) FILTER (WHERE sa.status = 'present'),
                   COUNT(*) FILTER (WHERE sa.status = 'absent'),
                   COUNT(*) FILTER (WHERE sa.status = 'excused'),
                   COUNT(*)
            FROM student_attendance sa
            JOIN circle_enrollments ce ON ce.id = sa.enrollment_id
            JOIN circles c ON c.id = ce.circle_id
            WHERE ce.student_id = @id AND sa.is_trashed = FALSE AND c.is_trashed = FALSE
              AND (@all OR c.id = ANY(@circles))
              AND sa.session_date BETWEEN @from AND @to;
            """, connection))
        {
            summary.Parameters.AddWithValue("id", id);
            summary.Parameters.AddWithValue("all", scope.All);
            summary.Parameters.AddWithValue("circles", scope.CircleIds);
            summary.Parameters.AddWithValue("from", start);
            summary.Parameters.AddWithValue("to", end);
            await using var reader = await summary.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            present = (int)reader.GetInt64(0);
            absent = (int)reader.GetInt64(1);
            excused = (int)reader.GetInt64(2);
            marked = (int)reader.GetInt64(3);
        }

        var history = new List<object>();
        await using (var sessions = new NpgsqlCommand("""
            SELECT sa.session_date, c.name, COALESCE(ss.starts_at, '00:00'::time), sa.status, sa.note
            FROM student_attendance sa
            JOIN circle_enrollments ce ON ce.id = sa.enrollment_id
            JOIN circles c ON c.id = ce.circle_id AND c.is_trashed = FALSE
            LEFT JOIN circle_schedule_slots ss ON ss.id = sa.schedule_slot_id
            WHERE ce.student_id = @id AND sa.is_trashed = FALSE
              AND (@all OR c.id = ANY(@circles))
              AND sa.session_date BETWEEN @from AND @to
            ORDER BY sa.session_date DESC, ss.starts_at DESC
            LIMIT 80;
            """, connection))
        {
            sessions.Parameters.AddWithValue("id", id);
            sessions.Parameters.AddWithValue("all", scope.All);
            sessions.Parameters.AddWithValue("circles", scope.CircleIds);
            sessions.Parameters.AddWithValue("from", start);
            sessions.Parameters.AddWithValue("to", end);
            await using var reader = await sessions.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                history.Add(new
                {
                    date = reader.GetFieldValue<DateOnly>(0),
                    circleName = reader.GetString(1),
                    startsAt = reader.GetFieldValue<TimeOnly>(2).ToString("HH:mm"),
                    status = reader.GetString(3),
                    note = reader.IsDBNull(4) ? null : reader.GetString(4)
                });
            }
        }

        var notes = new List<object>();
        var subscription = new List<object>();
        var canFinance = TeachingPrincipal.Has(principal, "finance.read");
        var canUnpaid = canFinance || TeachingPrincipal.Has(principal, "supervisor.unpaid") || TeachingPrincipal.Has(principal, "users.manage");
        if (canUnpaid)
        {
            await using var subscriptionCommand = new NpgsqlCommand("""
                SELECT c.name, mc.amount_due, COALESCE(p.paid, 0)
                FROM monthly_charges mc
                JOIN circle_enrollments ce ON ce.id = mc.enrollment_id AND ce.is_trashed = FALSE
                JOIN circles c ON c.id = ce.circle_id AND c.is_trashed = FALSE
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(amount), 0) AS paid
                    FROM payments
                    WHERE monthly_charge_id = mc.id AND is_trashed = FALSE AND voided_at IS NULL
                ) p ON TRUE
                WHERE ce.student_id = @id AND mc.is_trashed = FALSE AND mc.voided_at IS NULL
                  AND mc.billing_month = date_trunc('month', @today::date)::date
                  AND (@all OR c.id = ANY(@circles))
                ORDER BY c.name
                LIMIT 20;
                """, connection);
            subscriptionCommand.Parameters.AddWithValue("id", id);
            subscriptionCommand.Parameters.AddWithValue("today", CairoTime.Today());
            subscriptionCommand.Parameters.AddWithValue("all", scope.All);
            subscriptionCommand.Parameters.AddWithValue("circles", scope.CircleIds);
            await using var reader = await subscriptionCommand.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var due = reader.GetDecimal(1);
                var paid = reader.GetDecimal(2);
                var balance = Money.Balance(due, paid);
                subscription.Add(new
                {
                    circleName = reader.GetString(0),
                    status = balance <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid",
                    amountDue = canFinance ? due : (decimal?)null,
                    paidAmount = canFinance ? paid : (decimal?)null,
                    balance = canFinance ? balance : (decimal?)null
                });
            }
        }

        await using (var notesCommand = new NpgsqlCommand("""
            SELECT sn.id, sn.note_text, sn.created_at, u.display_name
            FROM student_notes sn
            LEFT JOIN app_users u ON u.id = sn.created_by
            WHERE sn.student_id = @id AND sn.is_trashed = FALSE
            ORDER BY sn.created_at DESC
            LIMIT 40;
            """, connection))
        {
            notesCommand.Parameters.AddWithValue("id", id);
            await using var reader = await notesCommand.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                notes.Add(new
                {
                    id = reader.GetGuid(0),
                    text = reader.GetString(1),
                    createdAt = reader.GetFieldValue<DateTimeOffset>(2),
                    createdBy = reader.IsDBNull(3) ? null : reader.GetString(3)
                });
            }
        }

        return Results.Ok(new
        {
            student = new
            {
                id = studentId,
                studentCode = code,
                fullName = name,
                phone,
                guardianName,
                guardianPhone,
                status,
                joinedOn,
                notes = generalNotes,
                circles
            },
            period = new { from = start, to = end },
            attendance = new
            {
                present,
                absent,
                excused,
                marked,
                rate = marked == 0 ? (double?)null : Math.Round(present * 100.0 / marked, 1)
            },
            history,
            notes,
            subscription = canUnpaid ? subscription : null
        });
    }
}
