using Npgsql;
using NpgsqlTypes;

namespace Dar.Common.Requests;

/// <summary>Applies the attendance/session rows for an approved request.</summary>
public static class RequestEffectApplier
{
    public const string CompletedSessionMessage =
        "لا يمكن اعتماد طلب غياب لموعد تم تسجيل حلقته. ارفض الطلب أو عدّل الحضور من الحلقة.";

    public static async Task<bool> HasCompletedSessionAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid slotId,
        DateOnly date,
        CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("""
            SELECT EXISTS(
                SELECT 1 FROM teacher_sessions
                WHERE schedule_slot_id=@slot AND session_date=@date AND status='completed'
            );
            """, connection, transaction);
        cmd.Parameters.AddWithValue("slot", slotId);
        cmd.Parameters.AddWithValue("date", date);
        return (bool)(await cmd.ExecuteScalarAsync(ct) ?? false);
    }

    public static async Task ApplyAttendanceStatusAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string type,
        Guid circleId,
        Guid teacherId,
        Guid slotId,
        DateOnly date,
        string? note,
        string reason,
        Guid reviewer,
        CancellationToken ct)
    {
        if (await HasCompletedSessionAsync(connection, transaction, slotId, date, ct))
            throw new InvalidOperationException(CompletedSessionMessage);

        var status = type == "absence" ? "absent" : "cancelled";
        await using var upsert = new NpgsqlCommand("""
            INSERT INTO teacher_attendance(
                schedule_slot_id,circle_id,teacher_id,session_date,scheduled_start,duration_minutes,
                status,hourly_rate_snapshot,payable_amount,note,marked_by,actual_duration_minutes,
                pay_basis,overtime_minutes,undertime_minutes,is_trashed)
            SELECT ss.id,@circle,@teacher,@date,ss.starts_at,ss.duration_minutes,
                   @status,t.hourly_rate,0,@note,@reviewer,0,'manual',0,0,FALSE
            FROM circle_schedule_slots ss JOIN teachers t ON t.id=@teacher
            WHERE ss.id=@slot
            ON CONFLICT (schedule_slot_id, session_date) WHERE is_trashed = FALSE DO UPDATE SET
                status=EXCLUDED.status,duration_minutes=EXCLUDED.duration_minutes,payable_amount=0,
                note=CASE
                    WHEN EXCLUDED.note IS NULL OR btrim(EXCLUDED.note)='' THEN teacher_attendance.note
                    WHEN teacher_attendance.note IS NULL OR btrim(teacher_attendance.note)='' THEN EXCLUDED.note
                    ELSE teacher_attendance.note || E'\n' || EXCLUDED.note END,
                marked_by=EXCLUDED.marked_by,marked_at=now(),
                actual_duration_minutes=0,pay_basis='manual',overtime_minutes=0,undertime_minutes=0,is_trashed=FALSE;
            """, connection, transaction);
        upsert.Parameters.AddWithValue("circle", circleId);
        upsert.Parameters.AddWithValue("teacher", teacherId);
        upsert.Parameters.AddWithValue("date", date);
        upsert.Parameters.AddWithValue("slot", slotId);
        upsert.Parameters.AddWithValue("status", status);
        upsert.Parameters.AddWithValue("note", (object?)note ?? reason);
        upsert.Parameters.AddWithValue("reviewer", reviewer);
        await upsert.ExecuteNonQueryAsync(ct);

        await using var session = new NpgsqlCommand("""
            UPDATE teacher_sessions SET status='cancelled',
                note=CASE
                    WHEN @note IS NULL OR btrim(@note)='' THEN note
                    WHEN note IS NULL OR btrim(note)='' THEN @note
                    ELSE note || E'\n' || @note END,
                updated_at=now()
            WHERE schedule_slot_id=@slot AND session_date=@date AND status IN ('in_progress','awaiting_attendance');
            """, connection, transaction);
        session.Parameters.AddWithValue("slot", slotId);
        session.Parameters.AddWithValue("date", date);
        session.Parameters.Add(new NpgsqlParameter("note", NpgsqlDbType.Text)
            { Value = (object?)note ?? DBNull.Value });
        await session.ExecuteNonQueryAsync(ct);
    }

    public static async Task ApplyCorrectionAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid attendanceId,
        int duration,
        string newStatus,
        decimal amount,
        int? payableDuration,
        string? note,
        Guid reviewer,
        CancellationToken ct)
    {
        await using var update = new NpgsqlCommand("""
            UPDATE teacher_attendance SET status=@status,duration_minutes=@duration,
                payable_amount=@amount,actual_duration_minutes=@duration,
                pay_basis='manual',
                note=CASE
                    WHEN @note IS NULL OR btrim(@note)='' THEN note
                    WHEN note IS NULL OR btrim(note)='' THEN @note
                    ELSE note || E'\n' || @note END,
                marked_by=@reviewer,marked_at=now(),
                overtime_minutes=0,undertime_minutes=0
            WHERE id=@id;
            """, connection, transaction);
        update.Parameters.AddWithValue("id", attendanceId);
        update.Parameters.AddWithValue("status", newStatus);
        update.Parameters.AddWithValue("duration", duration);
        update.Parameters.AddWithValue("amount", amount);
        update.Parameters.Add(new NpgsqlParameter("note", NpgsqlDbType.Text) { Value = (object?)note ?? DBNull.Value });
        update.Parameters.AddWithValue("reviewer", reviewer);
        await update.ExecuteNonQueryAsync(ct);

        await using var session = new NpgsqlCommand("""
            UPDATE teacher_sessions SET actual_duration_minutes=@duration,payable_duration_minutes=@payableDuration,
                pay_basis='manual',overtime_minutes=0,undertime_minutes=0,
                status=CASE WHEN @status='present' AND status='cancelled' THEN 'completed' ELSE status END,
                note=CASE
                    WHEN @note IS NULL OR btrim(@note)='' THEN note
                    WHEN note IS NULL OR btrim(note)='' THEN @note
                    ELSE note || E'\n' || @note END,
                updated_at=now()
            WHERE id=(SELECT teacher_session_id FROM teacher_attendance WHERE id=@attendance);
            """, connection, transaction);
        session.Parameters.AddWithValue("attendance", attendanceId);
        session.Parameters.AddWithValue("duration", duration);
        session.Parameters.AddWithValue("payableDuration", (object?)payableDuration ?? DBNull.Value);
        session.Parameters.AddWithValue("status", newStatus);
        session.Parameters.Add(new NpgsqlParameter("note", NpgsqlDbType.Text)
            { Value = (object?)note ?? DBNull.Value });
        await session.ExecuteNonQueryAsync(ct);
    }
}
