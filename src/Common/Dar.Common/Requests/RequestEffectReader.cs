using Npgsql;

namespace Dar.Common.Requests;

public static class RequestEffectReader
{
    public static async Task<string?> ReadAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid slotId,
        DateOnly? date,
        Guid attendanceId,
        CancellationToken ct)
    {
        string sql;
        if (attendanceId != Guid.Empty)
            sql = """
                SELECT jsonb_build_object('attendance', to_jsonb(ta), 'session', to_jsonb(ts))::text
                FROM (SELECT 1) anchor
                LEFT JOIN teacher_attendance ta ON ta.id=@attendance
                LEFT JOIN teacher_sessions ts ON ts.id=ta.teacher_session_id;
                """;
        else if (slotId != Guid.Empty && date is not null)
            sql = """
                SELECT jsonb_build_object('attendance', to_jsonb(ta), 'session', to_jsonb(ts))::text
                FROM (SELECT 1) anchor
                LEFT JOIN teacher_attendance ta ON ta.schedule_slot_id=@slot AND ta.session_date=@date AND ta.is_trashed=FALSE
                LEFT JOIN teacher_sessions ts ON ts.schedule_slot_id=@slot AND ts.session_date=@date;
                """;
        else
            return null;

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("attendance", attendanceId == Guid.Empty ? DBNull.Value : attendanceId);
        command.Parameters.AddWithValue("slot", slotId);
        command.Parameters.AddWithValue("date", (object?)date ?? DBNull.Value);
        return await command.ExecuteScalarAsync(ct) as string;
    }
}
