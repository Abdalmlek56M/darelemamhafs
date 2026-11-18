using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private static void MapScheduleAndAttendance(WebApplication app)
    {
        app.MapGet("/api/schedule-slots", async Task<IResult> (NpgsqlDataSource db, CancellationToken ct) =>
        {
            var rows = new List<object>();
            await using var cmd = db.CreateCommand("""
                SELECT ss.id,ss.circle_id,c.name,c.teacher_id,COALESCE(t.full_name,''),ss.day_of_week,ss.starts_at,ss.duration_minutes,ss.is_active,c.is_active
                FROM circle_schedule_slots ss JOIN circles c ON c.id=ss.circle_id
                LEFT JOIN teachers t ON t.id=c.teacher_id
                WHERE ss.is_trashed=FALSE AND c.is_trashed=FALSE
                  AND (ss.is_active=TRUE OR EXISTS(SELECT 1 FROM teacher_attendance ta WHERE ta.schedule_slot_id=ss.id AND ta.is_trashed=FALSE)
                    OR EXISTS(SELECT 1 FROM student_attendance sa WHERE sa.schedule_slot_id=ss.id AND sa.is_trashed=FALSE))
                ORDER BY ss.is_active DESC,ss.day_of_week,ss.starts_at,c.name;
                """);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(new
            {
                id = reader.GetGuid(0), circleId = reader.GetGuid(1), circleName = reader.GetString(2),
                teacherId = reader.IsDBNull(3) ? (Guid?)null : reader.GetGuid(3), teacherName = reader.GetString(4),
                dayOfWeek = reader.GetInt16(5), startsAt = reader.GetFieldValue<TimeOnly>(6).ToString("HH:mm"), durationMinutes = reader.GetInt32(7), isActive = reader.GetBoolean(8), circleIsActive = reader.GetBoolean(9)
            });
            return Results.Ok(rows);
        }).RequireAuthorization("schedule.access");

        app.MapPost("/api/schedule-slots", async Task<IResult> (ScheduleSlotWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (request.CircleId == Guid.Empty || request.DayOfWeek is < 0 or > 6 || request.DurationMinutes is < 15 or > 360 ||
                !TimeOnly.TryParseExact(request.StartsAt, "HH:mm", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var startsAt))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["schedule"] = ["حدد الحلقة واليوم والوقت، واجعل مدة الحلقة من 15 إلى 360 دقيقة."] });
            try
            {
                await using var cmd = db.CreateCommand("""
                    INSERT INTO circle_schedule_slots(circle_id,day_of_week,starts_at,duration_minutes,is_active)
                    SELECT c.id,@day,@time,@duration,TRUE FROM circles c
                    WHERE c.id=@circle AND c.is_trashed=FALSE AND c.is_active=TRUE AND c.teacher_id IS NOT NULL
                    RETURNING id;
                    """);
                cmd.Parameters.AddWithValue("circle", request.CircleId); cmd.Parameters.AddWithValue("day", (short)request.DayOfWeek);
                cmd.Parameters.AddWithValue("time", startsAt); cmd.Parameters.AddWithValue("duration", request.DurationMinutes);
                var value = await cmd.ExecuteScalarAsync(ct);
                if (value is null) return Results.Conflict(new { message = "الحلقة غير موجودة أو متوقفة أو لم تُسند إلى معلمة. فعّل الحلقة وحدد المعلمة المسؤولة أولًا." });
                var id = (Guid)value;
                await using var audit = db.CreateCommand("INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details) VALUES(@actor,'schedule.create','circle_schedule_slot',@id,jsonb_build_object('dayOfWeek',@day,'startsAt',@time,'durationMinutes',@duration));");
                audit.Parameters.AddWithValue("actor", ActorId(principal)); audit.Parameters.AddWithValue("id", id); audit.Parameters.AddWithValue("day", request.DayOfWeek); audit.Parameters.AddWithValue("time", startsAt.ToString("HH:mm")); audit.Parameters.AddWithValue("duration", request.DurationMinutes); await audit.ExecuteNonQueryAsync(ct);
                return Results.Created($"/api/schedule-slots/{id}", new { id, request.CircleId, request.DayOfWeek, startsAt = startsAt.ToString("HH:mm"), request.DurationMinutes });
            }
            catch (PostgresException ex) when (ex.SqlState == "23505") { return Results.Conflict(new { message = "هذا الموعد مسجل للحلقة في اليوم والوقت نفسيهما بالفعل." }); }
            catch (PostgresException ex) when (ex.SqlState == "23514" && ex.ConstraintName == "ck_teacher_schedule_no_overlap")
            { return Results.Conflict(new { message = "توجد حصة أخرى للمعلمة نفسها تتداخل مع هذا الموعد. اختر وقتًا غير متداخل؛ يُسمح بالمواعيد المتتالية." }); }
        }).RequireAuthorization("schedule.edit");


        app.MapGet("/api/teacher-attendance", async Task<IResult> (string? month, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var financeVisible = CanReadFinance(principal);
            if (!TryMonth(month, out var from)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
            var to = from.AddMonths(1);
            var rows = new List<object>();
            await using var cmd = db.CreateCommand("""
                SELECT a.id,a.schedule_slot_id,a.circle_id,c.name,a.teacher_id,t.full_name,a.session_date,a.scheduled_start,a.duration_minutes,a.status,a.hourly_rate_snapshot,a.payable_amount,a.note,a.marked_at
                FROM teacher_attendance a JOIN circles c ON c.id=a.circle_id JOIN teachers t ON t.id=a.teacher_id
                WHERE a.session_date>=@from AND a.session_date<@to AND a.is_trashed=FALSE AND c.is_trashed=FALSE
                ORDER BY a.session_date DESC,a.scheduled_start DESC,t.full_name;
                """);
            cmd.Parameters.AddWithValue("from", from); cmd.Parameters.AddWithValue("to", to);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(new
            {
                id = reader.GetGuid(0), scheduleSlotId = reader.IsDBNull(1) ? (Guid?)null : reader.GetGuid(1), circleId = reader.GetGuid(2), circleName = reader.GetString(3),
                teacherId = reader.GetGuid(4), teacherName = reader.GetString(5), sessionDate = reader.GetFieldValue<DateOnly>(6), startsAt = reader.GetFieldValue<TimeOnly>(7).ToString("HH:mm"),
                durationMinutes = reader.GetInt32(8), status = reader.GetString(9), hourlyRateSnapshot = financeVisible ? reader.GetDecimal(10) : (decimal?)null, payableAmount = financeVisible ? reader.GetDecimal(11) : (decimal?)null,
                note = reader.IsDBNull(12) ? null : reader.GetString(12), markedAt = reader.GetFieldValue<DateTimeOffset>(13)
            });
            return Results.Ok(rows);
        }).RequireAuthorization("attendance.access");

        app.MapPut("/api/teacher-attendance/{id:guid}/duration", async Task<IResult> (Guid id, TeacherAttendanceDurationRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (request.DurationMinutes is < 15 or > 360)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["durationMinutes"] = ["مدة الحصة يجب أن تكون من 15 إلى 360 دقيقة."] });
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            string? before;
            decimal hourlyRateSnapshot;
            string? savedStatus;
            DateOnly sessionDate;
            await using (var read = new NpgsqlCommand("SELECT to_jsonb(a)::text,a.hourly_rate_snapshot,a.status,a.session_date FROM teacher_attendance a WHERE id=@id AND is_trashed=FALSE FOR UPDATE;", conn, tx))
            {
                read.Parameters.AddWithValue("id", id);
                await using var reader = await read.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct)) return Results.NotFound(new { message = "سجل الحضور غير موجود أو موجود في المهملات." });
                before = reader.GetString(0);
                hourlyRateSnapshot = reader.GetDecimal(1);
                savedStatus = reader.GetString(2);
                sessionDate = reader.GetFieldValue<DateOnly>(3);
            }
            if (savedStatus != "present") return Results.Conflict(new { message = "لا يمكن تعديل مدة حصة عند تسجيل المعلمة غائبة أو إلغاء الحصة. سجّل الحضور أولًا إذا كانت الحالة غير صحيحة." });
            if (await PayrollLockService.IsLockedAsync(db, sessionDate, ct))
                return Results.Conflict(new { message = "مسير رواتب هذا الشهر مقفل. افتح المسير من شاشة المواعيد قبل تعديل المدة أو الأجر." });
            if (!MoneyRules.TryCalculateTeacherPayableAmount(hourlyRateSnapshot, request.DurationMinutes, out var normalizedPayable))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["durationMinutes"] = ["قيمة المستحق الناتج تتجاوز الحد المالي المسموح لهذه الحصة."] });
            await using var update = new NpgsqlCommand("UPDATE teacher_attendance SET duration_minutes=@duration,payable_amount=@payable,marked_by=@actor,marked_at=now() WHERE id=@id AND status='present' RETURNING id,duration_minutes,payable_amount,hourly_rate_snapshot,status;", conn, tx);
            update.Parameters.AddWithValue("id", id); update.Parameters.AddWithValue("duration", request.DurationMinutes); update.Parameters.AddWithValue("payable", normalizedPayable); update.Parameters.AddWithValue("actor", ActorId(principal));
            Guid savedId; int duration; decimal payable, rate; string status;
            await using (var reader = await update.ExecuteReaderAsync(ct)) { await reader.ReadAsync(ct); savedId=reader.GetGuid(0); duration=reader.GetInt32(1); payable=reader.GetDecimal(2); rate=reader.GetDecimal(3); status=reader.GetString(4); }
            await using (var afterCmd = new NpgsqlCommand("SELECT to_jsonb(a)::text FROM teacher_attendance a WHERE id=@id;", conn, tx))
            { afterCmd.Parameters.AddWithValue("id", id); var after=(string?)await afterCmd.ExecuteScalarAsync(ct);
              await using var audit = new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,actor_display_name,action_code,entity_type,entity_id,details,before_data,after_data,request_path,http_method,can_restore) VALUES(@actor,@name,'attendance.duration.update','teacher_attendance',@id,jsonb_build_object('durationMinutes',@duration,'payableAmount',@payable),@before::jsonb,@after::jsonb,'/api/teacher-attendance/'||@id||'/duration','PUT',TRUE);", conn, tx);
              audit.Parameters.AddWithValue("actor", ActorId(principal)); audit.Parameters.AddWithValue("name", principal.FindFirstValue("display_name") ?? "حساب غير معروف"); audit.Parameters.AddWithValue("id", id); audit.Parameters.AddWithValue("duration", duration); audit.Parameters.AddWithValue("payable", payable); audit.Parameters.AddWithValue("before", before); audit.Parameters.AddWithValue("after", (object?)after ?? DBNull.Value); await audit.ExecuteNonQueryAsync(ct); }
            await tx.CommitAsync(ct);
            return Results.Ok(new { id=savedId, durationMinutes=duration, payableAmount=CanReadFinance(principal) ? payable : (decimal?)null, hourlyRateSnapshot=CanReadFinance(principal) ? rate : (decimal?)null, status });
        }).RequireAuthorization("attendance.edit");

        app.MapGet("/api/student-attendance/roster", async Task<IResult> (Guid scheduleSlotId, DateOnly date, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var rows = new List<object>();
            await using var cmd = db.CreateCommand("""
                WITH candidates AS (
                    SELECT ce.id AS enrollment_id, s.id AS student_id, s.student_code, s.full_name,
                           sa.status, sa.note,
                           (ce.starts_on<=@date AND (ce.ends_on IS NULL OR ce.ends_on>=@date) AND attendance_circle.starts_on<=@date
                             AND public.dar_enrollment_is_attendance_eligible_on_date(ce.id,@date)) AS eligible_for_date,
                           CASE
                             WHEN attendance_circle.starts_on>@date THEN 'before-circle-start'
                             WHEN ce.starts_on>@date THEN 'before-enrollment-start'
                             WHEN ce.ends_on IS NOT NULL AND @date>ce.ends_on THEN 'after-enrollment-end'
                             WHEN COALESCE(lifecycle.status_at_date, CASE WHEN ce.ends_on IS NOT NULL AND @date>ce.ends_on THEN 'ended' WHEN ce.status='paused' AND @date>=CURRENT_DATE THEN 'paused' ELSE 'active' END)='paused' THEN 'paused'
                             WHEN NOT public.dar_enrollment_is_attendance_eligible_on_date(ce.id,@date) THEN 'not-active-on-date'
                             ELSE NULL
                           END AS eligibility_reason,
                           ce.starts_on, ce.ends_on,
                           COALESCE(lifecycle.status_at_date, CASE WHEN ce.ends_on IS NOT NULL AND @date>ce.ends_on THEN 'ended' WHEN ce.status='paused' AND @date>=CURRENT_DATE THEN 'paused' ELSE 'active' END) AS enrollment_status_at_date,
                           ROW_NUMBER() OVER (
                             PARTITION BY s.id
                             ORDER BY (sa.id IS NOT NULL) DESC,
                                      (ce.starts_on<=@date AND (ce.ends_on IS NULL OR ce.ends_on>=@date) AND attendance_circle.starts_on<=@date
                                        AND public.dar_enrollment_is_attendance_eligible_on_date(ce.id,@date)) DESC,
                                      (ce.status='active') DESC, ce.starts_on DESC, ce.created_at DESC, ce.id DESC
                           ) AS student_row
                    FROM circle_schedule_slots ss
                    JOIN circle_enrollments ce ON ce.circle_id=ss.circle_id AND ce.is_trashed=FALSE
                    JOIN circles attendance_circle ON attendance_circle.id=ss.circle_id AND attendance_circle.is_trashed=FALSE
                    JOIN students s ON s.id=ce.student_id AND s.is_trashed=FALSE
                    LEFT JOIN student_attendance sa ON sa.enrollment_id=ce.id AND sa.schedule_slot_id=ss.id AND sa.session_date=@date AND sa.is_trashed=FALSE
                    LEFT JOIN LATERAL (
                        SELECT public.dar_enrollment_status_at_date(ce.id,@date) AS status_at_date
                    ) lifecycle ON TRUE
                    WHERE ss.id=@slot AND ss.is_trashed=FALSE
                )
                SELECT enrollment_id,student_id,student_code,full_name,status,note,eligible_for_date,eligibility_reason,starts_on,ends_on,enrollment_status_at_date
                FROM candidates WHERE student_row=1
                ORDER BY eligible_for_date DESC,full_name;
                """);
            cmd.Parameters.AddWithValue("slot", scheduleSlotId); cmd.Parameters.AddWithValue("date", date);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(new { enrollmentId=reader.GetGuid(0), studentId=reader.GetGuid(1), studentCode=reader.GetString(2), studentName=reader.GetString(3), status=reader.IsDBNull(4)?null:reader.GetString(4), note=reader.IsDBNull(5)?null:reader.GetString(5), eligibleForDate=reader.GetBoolean(6), eligibilityReason=reader.IsDBNull(7)?null:reader.GetString(7), startsOn=reader.GetFieldValue<DateOnly>(8), endsOn=reader.IsDBNull(9)?(DateOnly?)null:reader.GetFieldValue<DateOnly>(9), enrollmentStatus=reader.GetString(10) });
            return Results.Ok(rows);
        }).RequireAuthorization("attendance.access");

        app.MapGet("/api/student-attendance/session-summary", async Task<IResult> (string? month, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!TryMonth(month, out var from)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
            var rows = new List<object>();
            await using var cmd = db.CreateCommand("""
                WITH month_days AS (
                    SELECT day_value::date AS session_date
                    FROM generate_series(@from::date::timestamp, (@to::date - 1)::timestamp, interval '1 day') AS day_value
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
                    WHERE ta.is_trashed=FALSE AND ta.schedule_slot_id IS NOT NULL AND ta.session_date>=@from AND ta.session_date<@to
                    UNION
                    SELECT sa.schedule_slot_id, ce.circle_id, sa.session_date
                    FROM student_attendance sa
                    JOIN circle_schedule_slots ss ON ss.id=sa.schedule_slot_id AND ss.is_trashed=FALSE
                    JOIN circle_enrollments ce ON ce.id=sa.enrollment_id AND ce.is_trashed=FALSE
                    WHERE sa.is_trashed=FALSE AND sa.session_date>=@from AND sa.session_date<@to
                ),
                per_student AS (
                    SELECT ses.slot_id,ses.session_date,s.id AS student_id,
                           BOOL_OR(ce.starts_on<=ses.session_date AND (ce.ends_on IS NULL OR ce.ends_on>=ses.session_date)
                             AND session_circle.starts_on<=ses.session_date
                             AND public.dar_enrollment_is_attendance_eligible_on_date(ce.id,ses.session_date)) AS eligible_for_date,
                           BOOL_OR(sa.id IS NOT NULL) AS has_saved_attendance,
                           BOOL_OR(sa.status='present') AS is_present,
                           BOOL_OR(ce.status='active' AND (ce.ends_on IS NULL OR ce.ends_on>=CURRENT_DATE) AND session_circle.starts_on<=CURRENT_DATE) AS is_current_roster
                    FROM sessions ses
                    JOIN circle_enrollments ce ON ce.circle_id=ses.circle_id AND ce.is_trashed=FALSE
                    JOIN students s ON s.id=ce.student_id AND s.is_trashed=FALSE
                    JOIN circles session_circle ON session_circle.id=ses.circle_id AND session_circle.is_trashed=FALSE
                    LEFT JOIN student_attendance sa ON sa.enrollment_id=ce.id AND sa.schedule_slot_id=ses.slot_id AND sa.session_date=ses.session_date AND sa.is_trashed=FALSE
                    GROUP BY ses.slot_id,ses.session_date,s.id
                ),
                counts AS (
                    SELECT slot_id,session_date,
                           COUNT(DISTINCT student_id) FILTER (WHERE is_current_roster OR eligible_for_date OR has_saved_attendance) AS total_students,
                           COUNT(DISTINCT student_id) FILTER (WHERE is_present) AS present_students
                    FROM per_student GROUP BY slot_id,session_date
                )
                SELECT ses.slot_id,ses.session_date,COALESCE(counts.total_students,0),COALESCE(counts.present_students,0)
                FROM sessions ses LEFT JOIN counts ON counts.slot_id=ses.slot_id AND counts.session_date=ses.session_date
                ORDER BY ses.session_date DESC,ses.slot_id;
                """);
            cmd.Parameters.AddWithValue("from", from); cmd.Parameters.AddWithValue("to", from.AddMonths(1));
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(new { scheduleSlotId=reader.GetGuid(0), sessionDate=reader.GetFieldValue<DateOnly>(1), totalStudents=reader.GetInt64(2), presentStudents=reader.GetInt64(3) });
            return Results.Ok(rows);
        }).RequireAuthorization("attendance.access");

        app.MapGet("/api/student-attendance", async Task<IResult> (string? month, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!TryMonth(month, out var from)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
            var rows = new List<object>();
            await using var cmd = db.CreateCommand("""
                SELECT sa.id,sa.schedule_slot_id,ce.id,s.id,s.student_code,s.full_name,c.id,c.name,
                       c.teacher_id,COALESCE(t.full_name,''),sa.session_date,ss.starts_at,sa.status,sa.note,sa.marked_at
                FROM student_attendance sa JOIN circle_enrollments ce ON ce.id=sa.enrollment_id
                JOIN students s ON s.id=ce.student_id JOIN circles c ON c.id=ce.circle_id
                JOIN circle_schedule_slots ss ON ss.id=sa.schedule_slot_id LEFT JOIN teachers t ON t.id=c.teacher_id
                WHERE sa.session_date>=@from AND sa.session_date<@to AND sa.is_trashed=FALSE
                  AND ce.is_trashed=FALSE AND s.is_trashed=FALSE AND c.is_trashed=FALSE
                ORDER BY sa.session_date DESC,ss.starts_at DESC,c.name,s.full_name;
                """);
            cmd.Parameters.AddWithValue("from", from); cmd.Parameters.AddWithValue("to", from.AddMonths(1));
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add(new { id=reader.GetGuid(0), scheduleSlotId=reader.GetGuid(1), enrollmentId=reader.GetGuid(2), studentId=reader.GetGuid(3), studentCode=reader.GetString(4), studentName=reader.GetString(5), circleId=reader.GetGuid(6), circleName=reader.GetString(7), teacherId=reader.IsDBNull(8)?(Guid?)null:reader.GetGuid(8), teacherName=reader.GetString(9), sessionDate=reader.GetFieldValue<DateOnly>(10), startsAt=reader.GetFieldValue<TimeOnly>(11).ToString("HH:mm"), status=reader.GetString(12), note=reader.IsDBNull(13)?null:reader.GetString(13), markedAt=reader.GetFieldValue<DateTimeOffset>(14) });
            return Results.Ok(rows);
        }).RequireAuthorization("attendance.access");

        app.MapPost("/api/student-attendance", async Task<IResult> (StudentAttendanceMarkRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (request.ScheduleSlotId==Guid.Empty || request.EnrollmentId==Guid.Empty || request.SessionDate==default || request.SessionDate>DateOnly.FromDateTime(DateTime.Today) || !new[] { "present", "absent", "excused" }.Contains(request.Status, StringComparer.Ordinal))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["attendance"] = ["حدد الحصة والطالب وتاريخًا مسجلًا اليوم أو قبله وحالة حضور صحيحة."] });
            await using var conn=await db.OpenConnectionAsync(ct); await using var tx=await conn.BeginTransactionAsync(ct);
            string? before=null; Guid? existingId=null;
            // Lock the student row so two enrollment records for the same student cannot create parallel attendance rows for one lesson.
            await using (var studentLock=new NpgsqlCommand("SELECT s.id FROM students s JOIN circle_enrollments ce ON ce.student_id=s.id WHERE ce.id=@enrollment AND s.is_trashed=FALSE FOR UPDATE OF s;",conn,tx))
            { studentLock.Parameters.AddWithValue("enrollment",request.EnrollmentId); if(await studentLock.ExecuteScalarAsync(ct) is not Guid) return Results.NotFound(new{message="ملف الطالب أو الالتحاق غير موجود."}); }
            await using (var validate=new NpgsqlCommand("""
                SELECT EXISTS(
                  SELECT 1
                  FROM circle_schedule_slots ss
                  JOIN circle_enrollments ce ON ce.circle_id=ss.circle_id
                  JOIN circles attendance_circle ON attendance_circle.id=ss.circle_id AND attendance_circle.is_trashed=FALSE
                  JOIN students s ON s.id=ce.student_id
                  WHERE ss.id=@slot AND ss.is_trashed=FALSE AND ce.id=@enrollment AND ce.is_trashed=FALSE AND s.is_trashed=FALSE
                    AND public.dar_enrollment_is_attendance_eligible_on_date(ce.id,@date)
                    AND attendance_circle.starts_on<=@date
                    AND (ce.ends_on IS NULL OR @date<=ce.ends_on)
                    AND (@allowHistorical=TRUE OR ce.starts_on<=@date)
                );
                """,conn,tx))
            { validate.Parameters.AddWithValue("slot",request.ScheduleSlotId);validate.Parameters.AddWithValue("enrollment",request.EnrollmentId);validate.Parameters.AddWithValue("date",request.SessionDate);validate.Parameters.AddWithValue("allowHistorical",request.AllowHistoricalEntry);if(!(bool)(await validate.ExecuteScalarAsync(ct)??false))return Results.Conflict(new{message="الطالب غير مسجل في هذه الحلقة في تاريخ الحصة، أو أن الموعد غير متاح."}); }
            await using (var existing=new NpgsqlCommand("""
                SELECT sa.id,to_jsonb(sa)::text FROM student_attendance sa
                JOIN circle_enrollments existing_enrollment ON existing_enrollment.id=sa.enrollment_id
                JOIN circle_enrollments requested_enrollment ON requested_enrollment.id=@enrollment
                WHERE sa.schedule_slot_id=@slot AND sa.session_date=@date AND sa.is_trashed=FALSE
                  AND existing_enrollment.student_id=requested_enrollment.student_id
                ORDER BY (sa.enrollment_id=@enrollment) DESC,sa.marked_at DESC,sa.id DESC LIMIT 1 FOR UPDATE OF sa;
                """,conn,tx))
            { existing.Parameters.AddWithValue("slot",request.ScheduleSlotId); existing.Parameters.AddWithValue("enrollment",request.EnrollmentId); existing.Parameters.AddWithValue("date",request.SessionDate); await using var existingReader=await existing.ExecuteReaderAsync(ct); if(await existingReader.ReadAsync(ct)){existingId=existingReader.GetGuid(0);before=existingReader.GetString(1);} }
            Guid id;
            if(existingId.HasValue)
            {
                await using var update=new NpgsqlCommand("UPDATE student_attendance SET enrollment_id=@enrollment,status=@status,note=@note,marked_by=@actor,marked_at=now() WHERE id=@id RETURNING id;",conn,tx);
                update.Parameters.AddWithValue("id",existingId.Value);update.Parameters.AddWithValue("enrollment",request.EnrollmentId);update.Parameters.AddWithValue("status",request.Status);update.Parameters.AddWithValue("note",(object?)request.Note?.Trim()??DBNull.Value);update.Parameters.AddWithValue("actor",ActorId(principal));id=(Guid)(await update.ExecuteScalarAsync(ct)??throw new InvalidOperationException("لم يتم تحديث الحضور."));
            }
            else
            {
                await using var save=new NpgsqlCommand("""
                    INSERT INTO student_attendance(schedule_slot_id,enrollment_id,session_date,status,note,marked_by,is_trashed)
                    VALUES(@slot,@enrollment,@date,@status,@note,@actor,FALSE) RETURNING id;
                    """,conn,tx);
                save.Parameters.AddWithValue("slot",request.ScheduleSlotId);save.Parameters.AddWithValue("enrollment",request.EnrollmentId);save.Parameters.AddWithValue("date",request.SessionDate);save.Parameters.AddWithValue("status",request.Status);save.Parameters.AddWithValue("note",(object?)request.Note?.Trim()??DBNull.Value);save.Parameters.AddWithValue("actor",ActorId(principal));id=(Guid)(await save.ExecuteScalarAsync(ct)??throw new InvalidOperationException("لم يتم حفظ الحضور."));
            }
            string? after;await using(var snap=new NpgsqlCommand("SELECT to_jsonb(sa)::text FROM student_attendance sa WHERE id=@id;",conn,tx)){snap.Parameters.AddWithValue("id",id);after=(string?)await snap.ExecuteScalarAsync(ct);}
            await using(var audit=new NpgsqlCommand("INSERT INTO audit_log(actor_user_id,actor_display_name,action_code,entity_type,entity_id,details,before_data,after_data,request_path,http_method,can_restore) VALUES(@actor,@name,@action,'student_attendance',@id,jsonb_build_object('status',@status,'sessionDate',@date,'historicalOverride',@allowHistorical),@before::jsonb,@after::jsonb,'/api/student-attendance','POST',FALSE);",conn,tx))
            {audit.Parameters.AddWithValue("actor",ActorId(principal));audit.Parameters.AddWithValue("name",principal.FindFirstValue("display_name")??"حساب غير معروف");audit.Parameters.AddWithValue("action",before is null?"student.attendance.create":"student.attendance.update");audit.Parameters.AddWithValue("id",id);audit.Parameters.AddWithValue("status",request.Status);audit.Parameters.AddWithValue("date",request.SessionDate);audit.Parameters.AddWithValue("allowHistorical",request.AllowHistoricalEntry);audit.Parameters.AddWithValue("before",(object?)before??DBNull.Value);audit.Parameters.AddWithValue("after",(object?)after??DBNull.Value);await audit.ExecuteNonQueryAsync(ct);}
            await tx.CommitAsync(ct);return Results.Ok(new{id,status=request.Status,sessionDate=request.SessionDate,enrollmentId=request.EnrollmentId,scheduleSlotId=request.ScheduleSlotId});
        }).RequireAuthorization("attendance.edit");

        app.MapPost("/api/teacher-attendance", async Task<IResult> (TeacherAttendanceMarkRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (request.ScheduleSlotId == Guid.Empty || request.SessionDate == default || !new[] { "present", "absent", "cancelled" }.Contains(request.Status, StringComparer.Ordinal))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["attendance"] = ["حدد الحصة وتاريخها والحالة الصحيحة للحضور."] });
            await using var conn = await db.OpenConnectionAsync(ct);
            await using var tx = await conn.BeginTransactionAsync(ct);
            Guid circleId; Guid? assignedTeacherId; string assignedTeacherName; TimeOnly startsAt; int duration; short slotDayOfWeek;
            await using (var info = new NpgsqlCommand("""
                SELECT ss.circle_id,c.teacher_id,COALESCE(t.full_name,''),ss.starts_at,ss.duration_minutes,ss.day_of_week
                FROM circle_schedule_slots ss JOIN circles c ON c.id=ss.circle_id
                LEFT JOIN teachers t ON t.id=c.teacher_id
                WHERE ss.id=@id AND ss.is_trashed=FALSE AND ss.is_active=TRUE AND c.is_trashed=FALSE AND c.is_active=TRUE
                FOR UPDATE OF ss;
                """, conn, tx))
            {
                info.Parameters.AddWithValue("id", request.ScheduleSlotId); await using var reader = await info.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct)) return Results.NotFound(new { message = "موعد الحلقة غير موجود أو متوقف." });
                circleId = reader.GetGuid(0); assignedTeacherId = reader.IsDBNull(1) ? null : reader.GetGuid(1); assignedTeacherName = reader.GetString(2); startsAt = reader.GetFieldValue<TimeOnly>(3); duration = reader.GetInt32(4); slotDayOfWeek = reader.GetInt16(5);
            }
            if ((short)request.SessionDate.DayOfWeek != slotDayOfWeek)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["attendance"] = ["تاريخ الحصة لا يطابق يوم الموعد الأسبوعي المحدد."] });
            if (request.SessionDate > DateOnly.FromDateTime(DateTime.Today))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["attendance"] = ["لا يمكن تسجيل حضور المعلمة بتاريخ مستقبلي."] });
            if (await PayrollLockService.IsLockedAsync(db, request.SessionDate, ct))
                return Results.Conflict(new { message = "مسير رواتب هذا الشهر مقفل. افتح المسير من شاشة المواعيد قبل تسجيل أو تعديل الحضور." });
            var teacherId = request.TeacherId ?? assignedTeacherId;
            if (!teacherId.HasValue) return Results.Conflict(new { message = "لا توجد معلمة مسندة للحلقة؛ اختر معلمة لهذه الحصة أولًا." });
            string selectedTeacherName; decimal hourlyRate;
            await using (var teacher = new NpgsqlCommand("SELECT full_name,hourly_rate FROM teachers WHERE id=@id AND is_trashed=FALSE AND status='active';", conn, tx))
            {
                teacher.Parameters.AddWithValue("id", teacherId.Value); await using var reader = await teacher.ExecuteReaderAsync(ct);
                if (!await reader.ReadAsync(ct)) return Results.Conflict(new { message = "المعلمة المختارة غير نشطة أو غير موجودة." });
                selectedTeacherName = reader.GetString(0); hourlyRate = reader.GetDecimal(1);
            }
            var isSubstitute = assignedTeacherId.HasValue && teacherId.Value != assignedTeacherId.Value;
            var note = isSubstitute ? $"بديلة عن {assignedTeacherName}" + (string.IsNullOrWhiteSpace(request.Note) ? string.Empty : $" · {request.Note.Trim()}") : request.Note?.Trim();
            var effectiveHourlyRate = hourlyRate;
            await using (var existing = new NpgsqlCommand("SELECT teacher_id,hourly_rate_snapshot FROM teacher_attendance WHERE schedule_slot_id=@slot AND session_date=@date FOR UPDATE;", conn, tx))
            {
                existing.Parameters.AddWithValue("slot", request.ScheduleSlotId); existing.Parameters.AddWithValue("date", request.SessionDate);
                await using var reader = await existing.ExecuteReaderAsync(ct);
                if (await reader.ReadAsync(ct) && reader.GetGuid(0) == teacherId.Value)
                    effectiveHourlyRate = reader.GetDecimal(1);
            }
            decimal payable = 0m;
            if (request.Status == "present" && !MoneyRules.TryCalculateTeacherPayableAmount(effectiveHourlyRate, duration, out payable))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["teacherId"] = ["المستحق المحسوب من Snapshot أجر الساعة لهذه الحصة يتجاوز الحد المالي المسموح."] });
            await using var cmd = new NpgsqlCommand("""
                INSERT INTO teacher_attendance(schedule_slot_id,circle_id,teacher_id,session_date,scheduled_start,duration_minutes,status,hourly_rate_snapshot,payable_amount,note,marked_by)
                VALUES(@slot,@circle,@teacher,@date,@start,@duration,@status,@rate,@payable,@note,@actor)
                ON CONFLICT(schedule_slot_id,session_date) DO UPDATE SET
                    teacher_id=EXCLUDED.teacher_id,
                    hourly_rate_snapshot=CASE
                        WHEN teacher_attendance.teacher_id IS DISTINCT FROM EXCLUDED.teacher_id THEN EXCLUDED.hourly_rate_snapshot
                        ELSE teacher_attendance.hourly_rate_snapshot
                    END,
                    scheduled_start=EXCLUDED.scheduled_start,
                    -- Preserve an explicitly corrected actual duration; re-marking a session
                    -- must not silently reset payroll to the scheduled slot length.
                    duration_minutes=teacher_attendance.duration_minutes,status=EXCLUDED.status,note=EXCLUDED.note,
                    marked_by=EXCLUDED.marked_by,marked_at=now(),
                    payable_amount=CASE WHEN EXCLUDED.status='present' THEN
                        teacher_attendance.duration_minutes * CASE
                            WHEN teacher_attendance.teacher_id IS DISTINCT FROM EXCLUDED.teacher_id THEN EXCLUDED.hourly_rate_snapshot
                            ELSE teacher_attendance.hourly_rate_snapshot
                        END / 60.0
                    ELSE 0 END
                RETURNING id,payable_amount,hourly_rate_snapshot;
                """, conn, tx);
            cmd.Parameters.AddWithValue("slot", request.ScheduleSlotId); cmd.Parameters.AddWithValue("circle", circleId); cmd.Parameters.AddWithValue("teacher", teacherId.Value);
            cmd.Parameters.AddWithValue("date", request.SessionDate); cmd.Parameters.AddWithValue("start", startsAt); cmd.Parameters.AddWithValue("duration", duration);
            cmd.Parameters.AddWithValue("status", request.Status); cmd.Parameters.AddWithValue("rate", hourlyRate); cmd.Parameters.AddWithValue("payable", payable); AddNullable(cmd, "note", note); cmd.Parameters.AddWithValue("actor", ActorId(principal));
            Guid savedId; decimal savedPayable; decimal savedRate;
            await using (var saved = await cmd.ExecuteReaderAsync(ct))
            {
                if (!await saved.ReadAsync(ct)) throw new InvalidOperationException("لم يتم حفظ سجل حضور المعلمة.");
                savedId = saved.GetGuid(0); savedPayable = saved.GetDecimal(1); savedRate = saved.GetDecimal(2);
            }
            await tx.CommitAsync(ct);
            return Results.Ok(new { id = savedId, payableAmount = CanReadFinance(principal) ? savedPayable : (decimal?)null, hourlyRateSnapshot = CanReadFinance(principal) ? savedRate : (decimal?)null, teacherId = teacherId.Value, teacherName = selectedTeacherName, isSubstitute, request.Status, request.SessionDate, request.ScheduleSlotId });
        }).RequireAuthorization("attendance.edit");
    }
}