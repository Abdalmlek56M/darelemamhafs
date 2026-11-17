using System.Security.Claims;
using System.Text.Json;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Requests;

public sealed record CreateRequestRequest(
    string Type,
    Guid? ScheduleSlotId,
    DateOnly? Date,
    Guid? AttendanceId,
    string Reason,
    int? ProposedDurationMinutes,
    string? ProposedNote);

public sealed record ReviewRequestRequest(bool Approve, string? Note);

public static class RequestHelpers
{
    public static bool TryType(string? value, out string type)
    {
        type = (value ?? string.Empty).Trim().ToLowerInvariant();
        return type is "absence" or "cancellation" or "correction";
    }

    public static string PayloadJson(int? duration, string? note, string? status) =>
        JsonSerializer.Serialize(new { durationMinutes = duration, note, status });

    public static async Task NotifyTeacherAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid teacherId,
        string title,
        string body,
        Guid requestId,
        string dedupe,
        CancellationToken ct)
    {
        Guid? userId = null;
        await using (var user = new NpgsqlCommand("""
            SELECT id FROM app_users
            WHERE teacher_id = @teacher AND is_active = TRUE AND is_locked = FALSE
            LIMIT 1;
            """, connection, transaction))
        {
            user.Parameters.AddWithValue("teacher", teacherId);
            userId = await user.ExecuteScalarAsync(ct) as Guid?;
        }

        if (userId is null) return;
        await TeachingNotifications.OpenAsync(connection, transaction, userId, null, "attendance", "info",
            title, body, "attendance_request", requestId, "/teacher/requests", dedupe, ct);
    }
}
