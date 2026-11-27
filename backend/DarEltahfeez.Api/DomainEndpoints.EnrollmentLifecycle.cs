using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private static async Task EnsureEnrollmentStatusBaselineAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Guid enrollmentId, DateOnly startsOn, string currentStatus, Guid actorId, CancellationToken ct)
    {
        await using var exists = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM audit_log WHERE entity_type='enrollment' AND entity_id=@id AND action_code IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end'));", conn, tx);
        exists.Parameters.AddWithValue("id", enrollmentId);
        if ((bool)(await exists.ExecuteScalarAsync(ct) ?? false)) return;

        // Legacy paused rows have no trustworthy historical pause date. Preserve their old effective history
        // as active from enrollment start, and establish the first provable paused point as today.
        await InsertEnrollmentStatusEventAsync(conn, tx, enrollmentId, "enrollment.status.baseline", "active", startsOn, "حالة أساس تاريخية؛ لا يتوفر تاريخ موثوق للإيقاف القديم.", actorId, ct);
        if (currentStatus == "paused")
            await InsertEnrollmentStatusEventAsync(conn, tx, enrollmentId, "enrollment.pause", "paused", DateOnly.FromDateTime(DateTime.Today), "تثبيت حالة الإيقاف القديمة من تاريخ تفعيل سجل الحالات.", actorId, ct);
    }

    private static async Task InsertEnrollmentStatusEventAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Guid enrollmentId, string actionCode, string status, DateOnly effectiveOn, string? reason, Guid actorId, CancellationToken ct)
    {
        await AuditLogWriter.WriteAsync(conn, tx, actorId, null, actionCode, "enrollment", enrollmentId,
            detailsJson: JsonSerializer.Serialize(new
            {
                status,
                effectiveOn,
                reason = reason?.Trim()
            }),
            cancellationToken: ct);
    }

    private static async Task<DateOnly?> GetLatestEnrollmentStatusDateAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Guid enrollmentId, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("SELECT NULLIF(details->>'effectiveOn','')::date FROM audit_log WHERE entity_type='enrollment' AND entity_id=@id AND action_code IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end') ORDER BY NULLIF(details->>'effectiveOn','')::date DESC,occurred_at DESC,id DESC LIMIT 1;", conn, tx);
        cmd.Parameters.AddWithValue("id", enrollmentId);
        var value = await cmd.ExecuteScalarAsync(ct);
        return value is DateOnly date ? date : null;
    }
}
