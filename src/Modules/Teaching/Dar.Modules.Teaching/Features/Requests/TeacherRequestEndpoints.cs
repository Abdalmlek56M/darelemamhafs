using System.Security.Claims;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Requests;

public static class TeacherRequestEndpoints
{
    public static async Task<IResult> Create(
        CreateRequestRequest request,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var teacherId = TeachingPrincipal.TeacherId(principal);
        var userId = TeachingPrincipal.UserId(principal);
        if (teacherId == Guid.Empty || userId == Guid.Empty)
            return Results.Json(new { message = "هذا الحساب غير مرتبط بمعلمة." }, statusCode: StatusCodes.Status403Forbidden);

        if (!RequestHelpers.TryType(request.Type, out var type))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["type"] = ["نوع الطلب غير صحيح."] });

        var reason = (request.Reason ?? string.Empty).Trim();
        if (reason.Length is < 3 or > 2000)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["reason"] = ["اكتب سببًا بين 3 و2000 حرف."] });

        Guid circleId, slotId = Guid.Empty, attendanceId = Guid.Empty;
        DateOnly? requestDate = null;
        string payload = "{}";

        await using var connection = await dataSource.OpenConnectionAsync(ct);

        if (type is "absence" or "cancellation")
        {
            if (request.ScheduleSlotId is null || request.Date is null)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["scheduleSlotId"] = ["حدد الحلقة والتاريخ."] });

            var day = request.Date.Value;
            var today = CairoTime.Today();
            if (day < today)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["date"] = ["لا يمكن طلب غياب أو إلغاء لتاريخ سابق."] });

            await using var slot = new NpgsqlCommand("""
                SELECT ss.circle_id, c.teacher_id
                FROM circle_schedule_slots ss
                JOIN circles c ON c.id = ss.circle_id AND c.is_trashed = FALSE AND c.is_active = TRUE
                WHERE ss.id = @slot AND ss.is_active = TRUE AND ss.is_trashed = FALSE
                  AND c.teacher_id = @teacher;
                """, connection);
            slot.Parameters.AddWithValue("slot", request.ScheduleSlotId.Value);
            slot.Parameters.AddWithValue("teacher", teacherId);
            await using var reader = await slot.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
                return Results.NotFound(new { message = "الحلقة غير موجودة أو غير مسندة إليك." });
            circleId = reader.GetGuid(0);
            slotId = request.ScheduleSlotId.Value;
            requestDate = day;
            payload = RequestHelpers.PayloadJson(null, null, type == "absence" ? "absent" : "cancelled");
        }
        else
        {
            if (request.AttendanceId is null)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["attendanceId"] = ["حدد الحصة المطلوب تصحيحها."] });

            await using var attendance = new NpgsqlCommand("""
                SELECT ta.circle_id, ta.teacher_id, ta.schedule_slot_id, ta.session_date,
                       ta.duration_minutes
                FROM teacher_attendance ta
                WHERE ta.id = @id AND ta.is_trashed = FALSE;
                """, connection);
            attendance.Parameters.AddWithValue("id", request.AttendanceId.Value);
            await using var reader = await attendance.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
                return Results.NotFound(new { message = "سجل الحضور غير موجود." });
            circleId = reader.GetGuid(0);
            if (reader.GetGuid(1) != teacherId)
                return Results.Json(new { message = "هذا السجل لا يخص حسابك." }, statusCode: StatusCodes.Status403Forbidden);
            slotId = reader.IsDBNull(2) ? Guid.Empty : reader.GetGuid(2);
            requestDate = reader.GetFieldValue<DateOnly>(3);
            attendanceId = request.AttendanceId.Value;
            var duration = request.ProposedDurationMinutes is >= 1 and <= 360 ? request.ProposedDurationMinutes : null;
            var proposedNote = string.IsNullOrWhiteSpace(request.ProposedNote) ? null : request.ProposedNote.Trim();
            payload = RequestHelpers.PayloadJson(duration, proposedNote, "present");
        }

        var id = Guid.NewGuid();
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await using (var insert = new NpgsqlCommand("""
            INSERT INTO attendance_requests(id, request_type, teacher_id, circle_id, schedule_slot_id,
                attendance_id, request_date, requested_by, reason, requested_payload)
            VALUES (@id, @type, @teacher, @circle, @slot, @attendance, @date, @user, @reason, @payload::jsonb);
            """, connection, transaction))
        {
            insert.Parameters.AddWithValue("id", id);
            insert.Parameters.AddWithValue("type", type);
            insert.Parameters.AddWithValue("teacher", teacherId);
            insert.Parameters.AddWithValue("circle", circleId);
            insert.Parameters.AddWithValue("slot", slotId == Guid.Empty ? DBNull.Value : slotId);
            insert.Parameters.AddWithValue("attendance", attendanceId == Guid.Empty ? DBNull.Value : attendanceId);
            insert.Parameters.AddWithValue("date", (object?)requestDate ?? DBNull.Value);
            insert.Parameters.AddWithValue("user", userId);
            insert.Parameters.AddWithValue("reason", reason);
            insert.Parameters.AddWithValue("payload", payload);
            await insert.ExecuteNonQueryAsync(ct);
        }

        await TeachingNotifications.OpenAsync(connection, transaction, null, "supervisor", "attendance", "info",
            type == "correction" ? "طلب تصحيح حضور" : type == "absence" ? "طلب غياب" : "طلب إلغاء حلقة",
            $"المعلمة أرسلت طلبًا: {reason}", "attendance_request", id, "/supervisor/requests", $"request:{id}", ct,
            circleId, teacherId);

        await TeachingAudit.WriteAsync(connection, transaction, principal, "teacher.request.create", "attendance_request", id,
            new { type, circleId, requestDate, reason }, "/api/v1/teacher/requests", "POST", ct);
        await transaction.CommitAsync(ct);

        return Results.Created($"/api/v1/teacher/requests/{id}", new { id, status = "pending" });
    }

    public static async Task<IResult> List(
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var teacherId = TeachingPrincipal.TeacherId(principal);
        if (teacherId == Guid.Empty)
            return Results.Json(new { message = "هذا الحساب غير مرتبط بمعلمة." }, statusCode: StatusCodes.Status403Forbidden);

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var command = new NpgsqlCommand("""
            SELECT r.id, r.request_type, c.name, r.request_date, r.reason, r.status,
                   r.created_at, r.review_note, r.reviewed_at, r.requested_payload::text
            FROM attendance_requests r
            JOIN circles c ON c.id = r.circle_id
            WHERE r.teacher_id = @teacher
            ORDER BY r.created_at DESC
            LIMIT 100;
            """, connection);
        command.Parameters.AddWithValue("teacher", teacherId);

        var rows = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            rows.Add(new
            {
                id = reader.GetGuid(0),
                type = reader.GetString(1),
                circleName = reader.GetString(2),
                date = reader.IsDBNull(3) ? (DateOnly?)null : reader.GetFieldValue<DateOnly>(3),
                reason = reader.GetString(4),
                status = reader.GetString(5),
                createdAt = reader.GetFieldValue<DateTimeOffset>(6),
                reviewNote = reader.IsDBNull(7) ? null : reader.GetString(7),
                reviewedAt = reader.IsDBNull(8) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(8),
                payload = reader.IsDBNull(9) ? null : reader.GetString(9)
            });
        }
        return Results.Ok(new { count = rows.Count, requests = rows });
    }

    public static async Task<IResult> Cancel(
        Guid id,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var teacherId = TeachingPrincipal.TeacherId(principal);
        var userId = TeachingPrincipal.UserId(principal);
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await using var command = new NpgsqlCommand("""
            UPDATE attendance_requests
            SET status='cancelled', updated_at=now()
            WHERE id=@id AND teacher_id=@teacher AND status='pending'
            RETURNING id;
            """, connection, transaction);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("teacher", teacherId);
        var updated = await command.ExecuteScalarAsync(ct);
        if (updated is null)
        {
            await transaction.RollbackAsync(ct);
            return Results.NotFound(new { message = "الطلب غير موجود أو لا يمكن إلغاؤه." });
        }
        await TeachingAudit.WriteAsync(connection, transaction, principal, "teacher.request.cancel", "attendance_request", id,
            new { id }, $"/api/v1/teacher/requests/{id}/cancel", "POST", ct);
        await transaction.CommitAsync(ct);
        return Results.Ok(new { id, status = "cancelled" });
    }
}
