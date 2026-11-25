using System.Text.Json;
using Npgsql;
using Dar.Common.Domain;

namespace Dar.Common.Requests;

public enum RequestReviewOutcome
{
    Ok,
    NotFound,
    AlreadyReviewed,
    Forbidden,
    MissingSchedule,
    MissingAttendance,
    InvalidDuration,
    InvalidStatus,
    InvalidAmount,
    Locked
}

public sealed record RequestCorrectionAudit(
    int OldDuration,
    string OldStatus,
    int NewDuration,
    string NewStatus,
    decimal Amount);

public sealed record RequestReviewResult(
    RequestReviewOutcome Outcome,
    string? Status = null,
    string? Type = null,
    Guid TeacherId = default,
    Guid CircleId = default,
    bool IsCorrection = false,
    RequestCorrectionAudit? Correction = null,
    Guid AttendanceId = default);

public static class RequestReviewService
{
    public static async Task<RequestReviewResult> ReviewAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid requestId,
        bool approve,
        string? note,
        Guid reviewer,
        Func<Guid, Guid, CancellationToken, Task<bool>>? authorize,
        CancellationToken ct)
    {
        string type, status, reason, payloadJson;
        Guid teacherId, circleId, slotId, attendanceId;
        DateOnly? requestDate;
        await using (var read = new NpgsqlCommand("""
            SELECT request_type,status,reason,teacher_id,circle_id,schedule_slot_id,
                   attendance_id,request_date,COALESCE(requested_payload::text,'{}')
            FROM attendance_requests WHERE id=@id FOR UPDATE;
            """, connection, transaction))
        {
            read.Parameters.AddWithValue("id", requestId);
            await using var reader = await read.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return new(RequestReviewOutcome.NotFound);
            type = reader.GetString(0); status = reader.GetString(1); reason = reader.GetString(2);
            teacherId = reader.GetGuid(3); circleId = reader.GetGuid(4);
            slotId = reader.IsDBNull(5) ? Guid.Empty : reader.GetGuid(5);
            attendanceId = reader.IsDBNull(6) ? Guid.Empty : reader.GetGuid(6);
            requestDate = reader.IsDBNull(7) ? null : reader.GetFieldValue<DateOnly>(7);
            payloadJson = reader.GetString(8);
        }

        if (authorize is not null && !await authorize(circleId, teacherId, ct))
            return new(RequestReviewOutcome.Forbidden, Type: type);
        if (!RequestWorkflow.CanReview(status))
            return new(RequestReviewOutcome.AlreadyReviewed, Type: type);

        var nextStatus = RequestWorkflow.ReviewStatus(approve);
        string? effectBefore = null;
        string? effectAfter = null;
        RequestCorrectionAudit? correction = null;

        if (approve)
        {
            effectBefore = await RequestEffectReader.ReadAsync(
                connection, transaction, slotId, requestDate, attendanceId, ct);
            if (type is "absence" or "cancellation")
            {
                if (slotId == Guid.Empty || requestDate is null)
                    return new(RequestReviewOutcome.MissingSchedule, Type: type);
                if (await IsLockedAsync(connection, transaction, requestDate.Value, ct))
                    return new(RequestReviewOutcome.Locked, Type: type);
                await RequestEffectApplier.ApplyAttendanceStatusAsync(
                    connection, transaction, type, circleId, teacherId, slotId,
                    requestDate.Value, note, reason, reviewer, ct);
            }
            else if (type == "correction")
            {
                var result = await ApplyCorrectionAsync(
                    connection, transaction, attendanceId, payloadJson, reviewer, ct);
                if (result.Outcome != RequestReviewOutcome.Ok) return result;
                correction = result.Correction;
            }
            effectAfter = await RequestEffectReader.ReadAsync(
                connection, transaction, slotId, requestDate, attendanceId, ct);
        }

        await using (var update = new NpgsqlCommand("""
            UPDATE attendance_requests SET status=@status,reviewed_by=@reviewer,
                reviewed_at=now(),review_note=@note,effect_before=@before::jsonb,
                effect_after=@after::jsonb,updated_at=now()
            WHERE id=@id;
            """, connection, transaction))
        {
            update.Parameters.AddWithValue("id", requestId);
            update.Parameters.AddWithValue("status", nextStatus);
            update.Parameters.AddWithValue("reviewer", reviewer);
            update.Parameters.Add(new NpgsqlParameter("note", NpgsqlTypes.NpgsqlDbType.Text)
                { Value = (object?)note ?? DBNull.Value });
            update.Parameters.AddWithValue("before", (object?)effectBefore ?? DBNull.Value);
            update.Parameters.AddWithValue("after", (object?)effectAfter ?? DBNull.Value);
            await update.ExecuteNonQueryAsync(ct);
        }

        return new(RequestReviewOutcome.Ok, nextStatus, type, teacherId, circleId,
            type == "correction", correction);
    }

    private static async Task<RequestReviewResult> ApplyCorrectionAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid attendanceId,
        string payloadJson,
        Guid reviewer,
        CancellationToken ct)
    {
        if (attendanceId == Guid.Empty)
            return new(RequestReviewOutcome.MissingAttendance, IsCorrection: true, Type: "correction");
        var payload = JsonDocument.Parse(payloadJson).RootElement;
        var duration = payload.TryGetProperty("durationMinutes", out var d)
            && d.TryGetInt32(out var parsed) ? parsed : 0;
        if (duration is < 1 or > 360)
            return new(RequestReviewOutcome.InvalidDuration, IsCorrection: true, Type: "correction");
        var note = payload.TryGetProperty("note", out var n) ? n.GetString() : null;
        var proposedStatus = payload.TryGetProperty("status", out var s) ? s.GetString() : null;
        if (proposedStatus is not null && proposedStatus is not ("present" or "absent" or "cancelled"))
            return new(RequestReviewOutcome.InvalidStatus, IsCorrection: true, Type: "correction");

        decimal rate; int oldDuration; string oldStatus; DateOnly date;
        await using (var current = new NpgsqlCommand("""
            SELECT hourly_rate_snapshot,duration_minutes,session_date,status
            FROM teacher_attendance WHERE id=@id AND is_trashed=FALSE FOR UPDATE;
            """, connection, transaction))
        {
            current.Parameters.AddWithValue("id", attendanceId);
            await using var reader = await current.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
                return new(RequestReviewOutcome.MissingAttendance, IsCorrection: true, Type: "correction");
            rate = reader.GetDecimal(0); oldDuration = reader.GetInt32(1);
            date = reader.GetFieldValue<DateOnly>(2); oldStatus = reader.GetString(3);
        }
        if (await IsLockedAsync(connection, transaction, date, ct))
            return new(RequestReviewOutcome.Locked, IsCorrection: true, Type: "correction");
        if (!Money.TryCalculateTeacherPayableAmount(rate, duration, out var computed))
            return new(RequestReviewOutcome.InvalidAmount, IsCorrection: true, Type: "correction");
        var newStatus = proposedStatus ?? oldStatus;
        var amount = newStatus == "present" ? computed : 0m;
        var payableDuration = newStatus == "present" ? (int?)duration : null;
        await RequestEffectApplier.ApplyCorrectionAsync(
            connection, transaction, attendanceId, duration, newStatus, amount,
            payableDuration, note, reviewer, ct);
        return new(RequestReviewOutcome.Ok, Type: "correction", IsCorrection: true,
            Correction: new RequestCorrectionAudit(oldDuration, oldStatus, duration, newStatus, amount));
    }

    private static async Task<bool> IsLockedAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        DateOnly date,
        CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("""
            SELECT is_locked FROM payroll_locks
            WHERE billing_month=date_trunc('month',@date::date)::date;
            """, connection, transaction);
        command.Parameters.AddWithValue("date", date);
        return await command.ExecuteScalarAsync(ct) is true;
    }
}
