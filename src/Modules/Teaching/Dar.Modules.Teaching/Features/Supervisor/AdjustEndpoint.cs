using System.Security.Claims;
using Dar.Common.Domain;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Supervisor;

public static class AdjustEndpoint
{
    public static async Task<IResult> Handle(
        Guid id,
        AdjustAttendanceRequest request,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        if (request.PayableDurationMinutes is < 1 or > 360)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["payableDurationMinutes"] = ["المدة يجب أن تكون بين 1 و360 دقيقة."] });
        if (string.IsNullOrWhiteSpace(request.Note))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["note"] = ["اكتب سبب التعديل."] });
        var hasFinance = TeachingPrincipal.Has(principal, "finance.read");
        if (request.PayableAmount is not null && !hasFinance)
            return Results.Json(new { message = "لا تملك صلاحية تعديل الأجر." }, statusCode: StatusCodes.Status403Forbidden);

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        decimal rate;
        int oldDuration;
        decimal oldAmount;
        string? oldNote;
        Guid? sessionId;
        await using (var current = new NpgsqlCommand("""
            SELECT hourly_rate_snapshot, duration_minutes, payable_amount, note, teacher_session_id
            FROM teacher_attendance
            WHERE id=@id AND is_trashed=FALSE
            FOR UPDATE;
            """, connection, transaction))
        {
            current.Parameters.AddWithValue("id", id);
            await using var reader = await current.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return Results.NotFound(new { message = "سجل الحضور غير موجود." });
            rate = reader.GetDecimal(0);
            oldDuration = reader.GetInt32(1);
            oldAmount = reader.GetDecimal(2);
            oldNote = reader.IsDBNull(3) ? null : reader.GetString(3);
            sessionId = reader.IsDBNull(4) ? null : reader.GetGuid(4);
        }

        decimal amount;
        if (request.PayableAmount is null)
        {
            if (!Money.TryCalculateTeacherPayableAmount(rate, request.PayableDurationMinutes, out amount))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["payableAmount"] = ["تعذر حساب الأجر."] });
        }
        else if (!Money.TryNormalizeNonNegativeCurrency(request.PayableAmount.Value, out amount))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["payableAmount"] = ["الأجر غير صالح."] });
        }

        var note = request.Note.Trim();
        var userId = TeachingPrincipal.UserId(principal);
        await using (var update = new NpgsqlCommand("""
            UPDATE teacher_attendance
            SET duration_minutes=@duration, payable_amount=@amount, pay_basis='manual',
                note=@note, marked_by=@actor, marked_at=now()
            WHERE id=@id;
            """, connection, transaction))
        {
            update.Parameters.AddWithValue("duration", request.PayableDurationMinutes);
            update.Parameters.AddWithValue("amount", amount);
            update.Parameters.AddWithValue("note", note);
            update.Parameters.AddWithValue("actor", userId);
            update.Parameters.AddWithValue("id", id);
            await update.ExecuteNonQueryAsync(ct);
        }

        if (sessionId is not null)
        {
            await using var session = new NpgsqlCommand("""
                UPDATE teacher_sessions
                SET payable_duration_minutes=@duration, pay_basis='manual', updated_at=now()
                WHERE id=@id;
                """, connection, transaction);
            session.Parameters.AddWithValue("duration", request.PayableDurationMinutes);
            session.Parameters.AddWithValue("id", sessionId.Value);
            await session.ExecuteNonQueryAsync(ct);
        }

        await TeachingAudit.WriteAsync(connection, transaction, principal, "supervisor.attendance.adjust", "teacher_attendance", id,
            new
            {
                before = new { durationMinutes = oldDuration, payableAmount = oldAmount, note = oldNote },
                after = new { durationMinutes = request.PayableDurationMinutes, payableAmount = amount, note },
                reason = note
            }, $"/api/v1/supervisor/attendance/{id}/adjust", "POST", ct);
        await transaction.CommitAsync(ct);

        return Results.Ok(new
        {
            attendanceId = id,
            payableMinutes = request.PayableDurationMinutes,
            payableAmount = hasFinance ? amount : (decimal?)null,
            payBasis = "manual",
            note
        });
    }
}
