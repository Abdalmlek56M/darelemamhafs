using System.Security.Claims;
using System.Text.Json;
using Dar.Common.Pagination;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private static async Task<StudentResponse?> LoadStudent(NpgsqlDataSource db,Guid id,bool financeVisible,CancellationToken ct)
    {
        await using var cmd=db.CreateCommand(StudentProjection+" WHERE s.id=@id AND s.is_trashed=FALSE;");cmd.Parameters.AddWithValue("id",id);await using var reader=await cmd.ExecuteReaderAsync(ct);return await reader.ReadAsync(ct)?ReadStudent(reader,financeVisible):null;
    }

    private static async Task<TeacherResponse?> LoadTeacher(NpgsqlDataSource db,Guid id,bool financeVisible,CancellationToken ct)
    {
        await using var cmd=db.CreateCommand("""
          SELECT t.id,t.teacher_code,t.full_name,t.phone,t.hourly_rate,t.status,t.notes,t.created_at,t.updated_at,
              COALESCE((SELECT string_agg(c.name,'، ' ORDER BY c.name) FROM circles c WHERE c.teacher_id=t.id AND c.is_trashed=FALSE), ''),
              (SELECT COUNT(*) FROM circles c WHERE c.teacher_id=t.id AND c.is_trashed=FALSE)
          FROM teachers t WHERE t.id=@id AND t.is_trashed=FALSE;
          """);cmd.Parameters.AddWithValue("id",id);await using var reader=await cmd.ExecuteReaderAsync(ct);return await reader.ReadAsync(ct)?ReadTeacher(reader,financeVisible):null;
    }

    private static async Task<CircleResponse?> LoadCircle(NpgsqlDataSource db,Guid id,bool financeVisible,CancellationToken ct)
    {
        await using var cmd=db.CreateCommand("SELECT c.id,c.circle_code,c.name,c.teacher_id,COALESCE(t.full_name,''),c.monthly_fee,c.schedule_text,c.is_active,c.created_at,c.updated_at,(SELECT COUNT(*) FROM circle_enrollments ce WHERE ce.circle_id=c.id AND ce.status='active' AND ce.is_trashed=FALSE),c.starts_on FROM circles c LEFT JOIN teachers t ON t.id=c.teacher_id WHERE c.id=@id AND c.is_trashed=FALSE;");
        cmd.Parameters.AddWithValue("id",id);await using var reader=await cmd.ExecuteReaderAsync(ct);return await reader.ReadAsync(ct)?ReadCircle(reader,financeVisible):null;
    }

    private static async Task<IResult> TeacherHistory(NpgsqlDataSource db, Guid id, int? page, int? pageSize, HttpContext http, ClaimsPrincipal principal, CancellationToken ct)
    {
        var financeVisible = CanReadFinance(principal);
        var teacher = await LoadTeacher(db, id, financeVisible, ct);
        if (teacher is null) return Results.NotFound();
        var paging = new PageRequest(page, pageSize);
        var paged = page is not null || pageSize is not null;
        var take = paged ? paging.PageSize : 100;

        var circlesVisible = principal.HasClaim("permission", "circles.read");
        var attendanceVisible = principal.HasClaim("permission", "attendance.read") || principal.HasClaim("permission", "attendance.edit");
        var circles = new List<object>();
        var scheduleSlots = new List<object>();
        var attendance = new List<object>();
        long attendanceTotal = 0;
        var notes = new List<StudentNoteResponse>();
        await using (var notesCmd = db.CreateCommand("SELECT n.id,n.note_text,n.created_at,COALESCE(u.display_name,'') FROM teacher_notes n LEFT JOIN app_users u ON u.id=n.created_by WHERE n.teacher_id=@teacher AND n.is_trashed=FALSE ORDER BY n.created_at DESC;"))
        {
            notesCmd.Parameters.AddWithValue("teacher", id);
            await using var notesReader = await notesCmd.ExecuteReaderAsync(ct);
            while (await notesReader.ReadAsync(ct)) notes.Add(new StudentNoteResponse(notesReader.GetGuid(0), notesReader.GetString(1), notesReader.GetFieldValue<DateTimeOffset>(2), notesReader.GetString(3)));
        }
        object? totals = null;

        if (circlesVisible)
        {
            await using var cmd = db.CreateCommand("""
                SELECT c.id,c.circle_code,c.name,c.monthly_fee,c.is_active,
                       (SELECT COUNT(*) FROM circle_enrollments ce WHERE ce.circle_id=c.id AND ce.status='active' AND ce.is_trashed=FALSE) AS active_student_count
                FROM circles c WHERE c.teacher_id=@teacher AND c.is_trashed=FALSE ORDER BY c.is_active DESC,c.name;
                """);
            cmd.Parameters.AddWithValue("teacher", id);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) circles.Add(new
            {
                id = reader.GetGuid(0), circleCode = reader.GetString(1), name = reader.GetString(2),
                monthlyFee = financeVisible ? reader.GetDecimal(3) : (decimal?)null, isActive = reader.GetBoolean(4), activeStudentCount = reader.GetInt64(5)
            });

            await using var slotsCmd = db.CreateCommand("""
                SELECT ss.id,ss.circle_id,c.name,ss.day_of_week,ss.starts_at,ss.duration_minutes,ss.is_active
                FROM circle_schedule_slots ss JOIN circles c ON c.id=ss.circle_id
                WHERE c.teacher_id=@teacher AND c.is_trashed=FALSE AND ss.is_trashed=FALSE
                ORDER BY ss.is_active DESC,ss.day_of_week,ss.starts_at;
                """);
            slotsCmd.Parameters.AddWithValue("teacher", id);
            await using var slotsReader = await slotsCmd.ExecuteReaderAsync(ct);
            while (await slotsReader.ReadAsync(ct)) scheduleSlots.Add(new
            {
                id = slotsReader.GetGuid(0), circleId = slotsReader.GetGuid(1), circleName = slotsReader.GetString(2),
                dayOfWeek = (int)slotsReader.GetInt16(3), startsAt = slotsReader.GetFieldValue<TimeOnly>(4).ToString("HH:mm"),
                durationMinutes = slotsReader.GetInt32(5), isActive = slotsReader.GetBoolean(6)
            });
        }

        if (attendanceVisible)
        {
            await using var cmd = db.CreateCommand("""
                SELECT a.id,a.session_date,COALESCE(c.name,'حلقة غير متاحة'),a.scheduled_start,a.duration_minutes,a.status,
                       a.hourly_rate_snapshot,a.payable_amount,a.note,a.marked_at,
                       CASE WHEN a.status='present' THEN (SELECT COUNT(DISTINCT ce.student_id) FROM student_attendance sa JOIN circle_enrollments ce ON ce.id=sa.enrollment_id WHERE sa.schedule_slot_id=a.schedule_slot_id
                          AND sa.session_date=a.session_date AND sa.status='present' AND sa.is_trashed=FALSE AND ce.is_trashed=FALSE) ELSE 0 END AS present_students_count, a.schedule_slot_id,
                       COUNT(*) OVER() AS total
                FROM teacher_attendance a LEFT JOIN circles c ON c.id=a.circle_id
                WHERE a.teacher_id=@teacher AND a.is_trashed=FALSE
                ORDER BY a.session_date DESC,a.scheduled_start DESC,a.id
                LIMIT @take OFFSET @skip;
                """);
            cmd.Parameters.AddWithValue("teacher", id);
            cmd.Parameters.AddWithValue("take", take);
            cmd.Parameters.AddWithValue("skip", paged ? paging.Offset : 0L);
            await using (var reader = await cmd.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                {
                    attendanceTotal = reader.ReadTotal();
                    attendance.Add(new
                    {
                        id = reader.GetGuid(0), sessionDate = reader.GetFieldValue<DateOnly>(1), circleName = reader.GetString(2),
                        startsAt = reader.GetFieldValue<TimeOnly>(3).ToString("HH:mm"), durationMinutes = reader.GetInt32(4), status = reader.GetString(5),
                        hourlyRateSnapshot = financeVisible ? reader.GetDecimal(6) : (decimal?)null, payableAmount = financeVisible ? reader.GetDecimal(7) : (decimal?)null, note = reader.IsDBNull(8) ? null : reader.GetString(8),
                        markedAt = reader.GetFieldValue<DateTimeOffset>(9), presentStudentsCount = reader.GetInt64(10), scheduleSlotId = reader.IsDBNull(11) ? (Guid?)null : reader.GetGuid(11)
                    });
                }
            }
            attendanceTotal = await PaginationRules.EnsureTotalAsync(cmd, attendanceTotal, paged, ct);

            await using var totalsCmd = db.CreateCommand("""
                SELECT COUNT(*) FILTER (WHERE status='present'),
                       COALESCE(SUM(duration_minutes) FILTER (WHERE status='present'),0),
                       COALESCE(SUM(payable_amount) FILTER (WHERE status='present'),0)
                FROM teacher_attendance WHERE teacher_id=@teacher AND is_trashed=FALSE;
                """);
            totalsCmd.Parameters.AddWithValue("teacher", id);
            await using var totalsReader = await totalsCmd.ExecuteReaderAsync(ct);
            if (await totalsReader.ReadAsync(ct)) totals = new
            {
                presentSessions = totalsReader.GetInt64(0),
                totalHours = totalsReader.GetInt64(1) / 60m,
                payableTotal = financeVisible ? totalsReader.GetDecimal(2) : (decimal?)null
            };
        }

        PaginationHeaderWriter.Write(http.Response, attendanceTotal, paging, attendance.Count, paged);
        return Results.Ok(new { teacher, circles, scheduleSlots, attendance, notes, attendanceVisible, circlesVisible, financeVisible, attendanceLimit = take, attendanceTotal, totals });
    }

    private static async Task<IResult> StudentHistory(NpgsqlDataSource db,Guid id,int? page,int? pageSize,HttpContext http,ClaimsPrincipal principal,CancellationToken ct)
    {
        var financeVisible = CanReadFinance(principal);
        var paging = new PageRequest(page, pageSize);
        var paged = page is not null || pageSize is not null;
        var take = paged ? paging.PageSize : 0;
        var student=await LoadStudent(db,id,financeVisible,ct);if(student is null)return Results.NotFound();
        var enrollments=new List<object>();
        await using(var cmd=db.CreateCommand("""
          SELECT ce.id,ce.circle_id,c.name,COALESCE(t.full_name,''),ce.starts_on,ce.ends_on,ce.agreed_monthly_fee,ce.status
          FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id LEFT JOIN teachers t ON t.id=c.teacher_id
          WHERE ce.student_id=@id AND ce.is_trashed=FALSE ORDER BY ce.starts_on DESC;
          """))
        {cmd.Parameters.AddWithValue("id",id);await using var reader=await cmd.ExecuteReaderAsync(ct);while(await reader.ReadAsync(ct))enrollments.Add(new{id=reader.GetGuid(0),circleId=reader.GetGuid(1),circleName=reader.GetString(2),teacherName=reader.GetString(3),startsOn=reader.GetFieldValue<DateOnly>(4),endsOn=reader.IsDBNull(5)?(DateOnly?)null:reader.GetFieldValue<DateOnly>(5),agreedMonthlyFee=financeVisible ? reader.GetDecimal(6) : (decimal?)null,status=reader.GetString(7)});}
        var charges=new Dictionary<Guid,ChargeHistoryBuilder>();
        if (financeVisible)
        {
            await using(var cmd=db.CreateCommand("""
              SELECT mc.id,mc.billing_month,mc.amount_due,mc.note,c.name,p.id,p.amount,p.paid_at,p.method,p.reference,p.note,(p.receipt_data IS NOT NULL),mc.voided_at,mc.void_reason,p.voided_at,p.void_reason,
                     CASE
                       WHEN ce.is_trashed OR s.is_trashed THEN 'التحاق الطالب أو ملفه محذوف.'
                       WHEN ce.status <> 'active' THEN 'اشتراك الطالب غير نشط.'
                       WHEN s.status <> 'active' THEN 'ملف الطالب غير نشط.'
                       WHEN (now() AT TIME ZONE 'Africa/Cairo')::date < ce.starts_on THEN 'لم تبدأ فترة اشتراك الطالب بعد.'
                       WHEN ce.ends_on IS NOT NULL AND (now() AT TIME ZONE 'Africa/Cairo')::date > ce.ends_on THEN 'انتهت فترة اشتراك الطالب.'
                       ELSE NULL
                     END AS void_blocked_reason
              FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id
              JOIN students s ON s.id=ce.student_id
              JOIN monthly_charges mc ON mc.enrollment_id=ce.id
              LEFT JOIN payments p ON p.monthly_charge_id=mc.id AND p.is_trashed=FALSE WHERE ce.student_id=@id AND ce.is_trashed=FALSE AND mc.is_trashed=FALSE
              ORDER BY mc.billing_month DESC,p.paid_at DESC;
              """))
            {cmd.Parameters.AddWithValue("id",id);await using var reader=await cmd.ExecuteReaderAsync(ct);while(await reader.ReadAsync(ct)){
                var chargeId=reader.GetGuid(0);if(!charges.TryGetValue(chargeId,out var charge)){charge=new ChargeHistoryBuilder(chargeId,reader.GetFieldValue<DateOnly>(1),reader.GetDecimal(2),reader.IsDBNull(3)?null:reader.GetString(3),reader.GetString(4),reader.IsDBNull(12)?(DateTimeOffset?)null:reader.GetFieldValue<DateTimeOffset>(12),reader.IsDBNull(13)?null:reader.GetString(13));charges.Add(chargeId,charge);}
                if(!reader.IsDBNull(5))charge.Payments.Add(new PaymentHistory(reader.GetGuid(5),reader.GetDecimal(6),reader.GetFieldValue<DateTimeOffset>(7),reader.IsDBNull(8)?null:reader.GetString(8),reader.IsDBNull(9)?null:reader.GetString(9),reader.IsDBNull(10)?null:reader.GetString(10),reader.GetBoolean(11),reader.IsDBNull(14)?(DateTimeOffset?)null:reader.GetFieldValue<DateTimeOffset>(14),reader.IsDBNull(15)?null:reader.GetString(15),reader.IsDBNull(16)?null:reader.GetString(16)));
              }}
        }
        var notes = new List<StudentNoteResponse>();
        long notesTotal = 0;
        var notesQuery = "SELECT n.id,n.note_text,n.created_at,COALESCE(u.display_name,''),COUNT(*) OVER() AS total FROM student_notes n LEFT JOIN app_users u ON u.id=n.created_by WHERE n.student_id=@id AND n.is_trashed=FALSE ORDER BY n.created_at DESC,n.id DESC";
        if (paged) notesQuery += " LIMIT @take OFFSET @skip";
        await using(var cmd=db.CreateCommand(notesQuery))
        {
            cmd.Parameters.AddWithValue("id",id);
            if (paged) { cmd.Parameters.AddWithValue("take", take); cmd.Parameters.AddWithValue("skip", paging.Offset); }
            await using var reader=await cmd.ExecuteReaderAsync(ct);
            while(await reader.ReadAsync(ct)){notesTotal=reader.ReadTotal();notes.Add(new StudentNoteResponse(reader.GetGuid(0),reader.GetString(1),reader.GetFieldValue<DateTimeOffset>(2),reader.GetString(3)));}
            await reader.DisposeAsync();
            notesTotal=await PaginationRules.EnsureTotalAsync(cmd,notesTotal,paged,ct);
        }
        var attendanceVisible = principal.HasClaim("permission", "attendance.read") || principal.HasClaim("permission", "attendance.edit");
        var attendance = new List<object>();
        long attendanceTotal = 0;
        if (attendanceVisible)
        {
            var attendanceQuery = """
                WITH ranked_attendance AS (
                    SELECT sa.id,sa.session_date,c.name AS circle_name,ss.starts_at,sa.status,COALESCE(t.full_name,'') AS teacher_name,sa.note,sa.marked_at,
                           ROW_NUMBER() OVER(PARTITION BY ce.student_id,sa.schedule_slot_id,sa.session_date ORDER BY sa.marked_at DESC,sa.id DESC) AS student_session_row
                    FROM student_attendance sa
                    JOIN circle_enrollments ce ON ce.id=sa.enrollment_id
                    JOIN circles c ON c.id=ce.circle_id
                    JOIN circle_schedule_slots ss ON ss.id=sa.schedule_slot_id
                    LEFT JOIN teachers t ON t.id=c.teacher_id
                    WHERE ce.student_id=@id AND sa.is_trashed=FALSE AND ce.is_trashed=FALSE AND c.is_trashed=FALSE
                )
                SELECT id,session_date,circle_name,starts_at,status,teacher_name,note,marked_at,COUNT(*) OVER() AS total
                FROM ranked_attendance WHERE student_session_row=1
                ORDER BY session_date DESC,starts_at DESC,marked_at DESC,id
                """;
            if (paged) attendanceQuery += " LIMIT @take OFFSET @skip";
            await using var cmd = db.CreateCommand(attendanceQuery);
            cmd.Parameters.AddWithValue("id", id);
            if (paged) { cmd.Parameters.AddWithValue("take", take); cmd.Parameters.AddWithValue("skip", paging.Offset); }
            await using (var reader = await cmd.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                {
                    attendanceTotal = reader.ReadTotal();
                    attendance.Add(new
                    {
                        id = reader.GetGuid(0), sessionDate = reader.GetFieldValue<DateOnly>(1), circleName = reader.GetString(2),
                        startsAt = reader.GetFieldValue<TimeOnly>(3).ToString("HH:mm"), status = reader.GetString(4), teacherName = reader.GetString(5),
                        note = reader.IsDBNull(6) ? null : reader.GetString(6), markedAt = reader.GetFieldValue<DateTimeOffset>(7)
                    });
                }
            }
            attendanceTotal = await PaginationRules.EnsureTotalAsync(cmd, attendanceTotal, paged, ct);
        }
        PaginationHeaderWriter.Write(http.Response, attendanceTotal, paging, attendance.Count, paged);
        return Results.Ok(new {student,enrollments,charges=charges.Values.Select(c=>c.ToResponse()),notes,attendance,attendanceVisible,attendanceTotal,notesTotal,financeVisible=principal.HasClaim("permission","finance.read")});
    }
    private static StudentResponse ReadStudent(NpgsqlDataReader r,bool financeVisible)=>new(r.GetGuid(0),r.GetString(1),r.GetString(2),r.IsDBNull(3)?null:r.GetInt32(3),r.IsDBNull(4)?null:r.GetString(4),r.IsDBNull(5)?null:r.GetString(5),r.IsDBNull(6)?null:r.GetString(6),r.GetFieldValue<DateOnly>(7),r.GetString(8),r.IsDBNull(9)?null:r.GetString(9),r.GetFieldValue<DateTimeOffset>(10),r.GetFieldValue<DateTimeOffset>(11),r.GetString(12),financeVisible?r.GetDecimal(13):null,financeVisible?r.GetDecimal(14):null,financeVisible?r.GetString(15):null);
    private static TeacherResponse ReadTeacher(NpgsqlDataReader r,bool financeVisible)=>new(r.GetGuid(0),r.GetString(1),r.GetString(2),r.IsDBNull(3)?null:r.GetString(3),financeVisible?r.GetDecimal(4):null,r.GetString(5),r.IsDBNull(6)?null:r.GetString(6),r.GetFieldValue<DateTimeOffset>(7),r.GetFieldValue<DateTimeOffset>(8),r.GetString(9),r.GetInt64(10));
    private static CircleResponse ReadCircle(NpgsqlDataReader r,bool financeVisible)=>new(r.GetGuid(0),r.GetString(1),r.GetString(2),r.IsDBNull(3)?null:r.GetGuid(3),r.GetString(4),financeVisible?r.GetDecimal(5):null,r.IsDBNull(6)?null:r.GetString(6),r.GetBoolean(7),r.GetFieldValue<DateTimeOffset>(8),r.GetFieldValue<DateTimeOffset>(9),r.GetInt64(10),r.GetFieldValue<DateOnly>(11));
}