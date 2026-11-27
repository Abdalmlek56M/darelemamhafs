using System.Security.Claims;
using System.Text.Json;
using Dar.Common.Pagination;
using Dar.Common.Requests;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class SystemAdminEndpoints
{
    internal static void MapRequests(WebApplication app)
    {
        MapPagedResetCandidates(app);
        MapRequestReview(app);
        MapRequestEdit(app);
    }


    private static async Task RestoreEffectAsync(NpgsqlConnection connection, NpgsqlTransaction transaction,
        string? beforeJson, string? afterJson, CancellationToken ct)
    {
        JsonElement before = default;
        JsonElement after = default;
        if (!string.IsNullOrWhiteSpace(beforeJson))
            using (var document = JsonDocument.Parse(beforeJson)) before = document.RootElement.Clone();
        if (!string.IsNullOrWhiteSpace(afterJson))
            using (var document = JsonDocument.Parse(afterJson)) after = document.RootElement.Clone();

        if (before.ValueKind == JsonValueKind.Object && before.TryGetProperty("attendance", out var beforeAttendance) && beforeAttendance.ValueKind == JsonValueKind.Object)
        {
            var id = beforeAttendance.GetProperty("id").GetGuid();
            await using var restore = new NpgsqlCommand("""
                UPDATE teacher_attendance ta SET
                    teacher_id=b.teacher_id,hourly_rate_snapshot=b.hourly_rate_snapshot,status=b.status,
                    duration_minutes=b.duration_minutes,payable_amount=b.payable_amount,note=b.note,
                    marked_by=b.marked_by,marked_at=b.marked_at,actual_duration_minutes=b.actual_duration_minutes,
                    pay_basis=b.pay_basis,overtime_minutes=b.overtime_minutes,undertime_minutes=b.undertime_minutes,
                    is_trashed=b.is_trashed
                FROM jsonb_populate_record(NULL::teacher_attendance, @json::jsonb) b
                WHERE ta.id=@id;
                """, connection, transaction);
            restore.Parameters.AddWithValue("json", beforeAttendance.GetRawText());
            restore.Parameters.AddWithValue("id", id);
            await restore.ExecuteNonQueryAsync(ct);
        }
        else if (after.ValueKind == JsonValueKind.Object && after.TryGetProperty("attendance", out var afterAttendance) && afterAttendance.ValueKind == JsonValueKind.Object)
        {
            var id = afterAttendance.GetProperty("id").GetGuid();
            await using var hide = new NpgsqlCommand("UPDATE teacher_attendance SET is_trashed=TRUE WHERE id=@id;", connection, transaction);
            hide.Parameters.AddWithValue("id", id);
            await hide.ExecuteNonQueryAsync(ct);
        }

        if (before.ValueKind == JsonValueKind.Object && before.TryGetProperty("session", out var beforeSession) && beforeSession.ValueKind == JsonValueKind.Object)
        {
            var id = beforeSession.GetProperty("id").GetGuid();
            await using var restore = new NpgsqlCommand("""
                UPDATE teacher_sessions ts SET
                    status=b.status,actual_duration_minutes=b.actual_duration_minutes,
                    payable_duration_minutes=b.payable_duration_minutes,pay_basis=b.pay_basis,
                    overtime_minutes=b.overtime_minutes,undertime_minutes=b.undertime_minutes,
                    note=b.note,updated_at=now()
                FROM jsonb_populate_record(NULL::teacher_sessions, @json::jsonb) b
                WHERE ts.id=@id;
                """, connection, transaction);
            restore.Parameters.AddWithValue("json", beforeSession.GetRawText());
            restore.Parameters.AddWithValue("id", id);
            await restore.ExecuteNonQueryAsync(ct);
        }
    }

    private static async Task NotifyTeacherAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, Guid teacherId,
        Guid requestId, string title, string body, CancellationToken ct)
    {
        Guid? userId = null;
        await using (var user = new NpgsqlCommand("""
            SELECT id FROM app_users WHERE teacher_id=@teacher AND is_active=TRUE AND is_locked=FALSE LIMIT 1;
            """, connection, transaction))
        {
            user.Parameters.AddWithValue("teacher", teacherId);
            userId = await user.ExecuteScalarAsync(ct) as Guid?;
        }
        if (userId is null) return;
        await using var command = new NpgsqlCommand("""
            INSERT INTO notifications(user_id,role_scope,category,status,severity,title,body,entity_type,entity_id,action_url,dedupe_key)
            VALUES(@user,'teacher','attendance','open','info',@title,@body,'attendance_request',@id,'/teacher/requests',@dedupe)
            ON CONFLICT(dedupe_key) DO UPDATE SET status='open',resolved_at=NULL,resolved_by=NULL,resolution_note=NULL,title=EXCLUDED.title,body=EXCLUDED.body;
            """, connection, transaction);
        command.Parameters.AddWithValue("user", userId.Value);
        command.Parameters.AddWithValue("title", title);
        command.Parameters.AddWithValue("body", body);
        command.Parameters.AddWithValue("id", requestId);
        command.Parameters.AddWithValue("dedupe", $"request-review:{requestId}");
        await command.ExecuteNonQueryAsync(ct);
    }

    private static async Task InsertRequestAuditAsync(NpgsqlConnection connection, NpgsqlTransaction transaction,
        Guid? actor, string? actorName, string action, string entityType, Guid entityId, string details, Guid requestId, CancellationToken ct)
    {
        await using var audit = new NpgsqlCommand("""
            INSERT INTO audit_log(actor_user_id,actor_display_name,action_code,entity_type,entity_id,details,request_path,http_method,can_restore)
            VALUES(@actor,@name,@action,@type,@id,@details::jsonb,@path,'POST',FALSE);
            """, connection, transaction);
        audit.Parameters.AddWithValue("actor", DbGuid(actor));
        audit.Parameters.AddWithValue("name", (object?)actorName ?? DBNull.Value);
        audit.Parameters.AddWithValue("action", action);
        audit.Parameters.AddWithValue("type", entityType);
        audit.Parameters.AddWithValue("id", entityId);
        audit.Parameters.AddWithValue("details", details);
        audit.Parameters.AddWithValue("path", $"/api/admin/requests/{requestId}/review");
        await audit.ExecuteNonQueryAsync(ct);
    }
}

public sealed record AdminReviewRequest(bool Approve, string? Note);
public sealed record AdminRequestEditRequest(string? Reason, DateOnly? Date, string? Payload);
