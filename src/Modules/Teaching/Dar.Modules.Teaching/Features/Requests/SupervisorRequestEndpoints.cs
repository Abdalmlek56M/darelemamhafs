using System.Security.Claims;
using System.Text.Json;
using Dar.Common.Requests;
using Dar.Common.Domain;
using Npgsql;
using NpgsqlTypes;
using Dar.Modules.Teaching.Features.Supervisor;
using Dar.Common.Pagination;

namespace Dar.Modules.Teaching.Features.Requests;

public static class SupervisorRequestEndpoints
{
    public static async Task<IResult> List(
        string? status,
        int? page,
        int? pageSize,
        HttpContext http,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var paging = new PageRequest(page, pageSize);
        var paged = page is not null || pageSize is not null;
        var filter = string.IsNullOrWhiteSpace(status) ? "pending" : status.Trim().ToLowerInvariant();
        if (filter is not ("pending" or "approved" or "rejected" or "cancelled" or "all"))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["status"] = ["حالة غير صحيحة."] });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);

        await using var command = new NpgsqlCommand("""
            SELECT r.id, r.request_type, t.full_name, r.teacher_id, c.name, r.circle_id,
                   r.request_date, r.reason, r.status, r.created_at, r.requested_payload::text,
                   r.review_note, r.reviewed_at, ta.id, COUNT(*) OVER() AS total
            FROM attendance_requests r
            JOIN teachers t ON t.id = r.teacher_id
            JOIN circles c ON c.id = r.circle_id
            LEFT JOIN teacher_attendance ta ON ta.id = r.attendance_id
            WHERE (@all OR r.circle_id = ANY(@circles))
              AND (@status = 'all' OR r.status = @status)
            ORDER BY (r.status = 'pending') DESC, r.created_at DESC, r.id
            LIMIT @take OFFSET @skip;
            """, connection);
        command.Parameters.AddWithValue("all", scope.All);
        command.Parameters.AddWithValue("circles", scope.CircleIds);
        command.Parameters.AddWithValue("status", filter);
        command.Parameters.AddWithValue("take", paged ? paging.PageSize : 200);
        command.Parameters.AddWithValue("skip", paged ? paging.Offset : 0L);

        long total = 0;
        var rows = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            total = reader.ReadTotal();
            rows.Add(new
            {
                id = reader.GetGuid(0),
                type = reader.GetString(1),
                teacherName = reader.GetString(2),
                teacherId = reader.GetGuid(3),
                circleName = reader.GetString(4),
                circleId = reader.GetGuid(5),
                date = reader.IsDBNull(6) ? (DateOnly?)null : reader.GetFieldValue<DateOnly>(6),
                reason = reader.GetString(7),
                status = reader.GetString(8),
                createdAt = reader.GetFieldValue<DateTimeOffset>(9),
                payload = reader.IsDBNull(10) ? null : reader.GetString(10),
                reviewNote = reader.IsDBNull(11) ? null : reader.GetString(11),
                reviewedAt = reader.IsDBNull(12) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(12),
                attendanceId = reader.IsDBNull(13) ? (Guid?)null : reader.GetGuid(13)
            });
        }
        await reader.DisposeAsync();
        total = await PaginationRules.EnsureTotalAsync(command, total, paged, ct);
        PaginationHeaderWriter.Write(http.Response, total, paging, rows.Count, paged);
        return Results.Ok(new { count = rows.Count, requests = rows });
    }

    public static async Task<IResult> Review(
        Guid id,
        ReviewRequestRequest request,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var reviewer = TeachingPrincipal.UserId(principal);
        var note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim();
        if (note is { Length: > 2000 })
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["note"] = ["الملاحظة طويلة جدًا."] });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        var result = await RequestReviewService.ReviewAsync(
            connection, transaction, id, request.Approve, note, reviewer,
            (circle, teacher, token) => Task.FromResult(
                scope.All || (scope.AllowsCircle(circle) && scope.AllowsTeacher(teacher))),
            ct);

        if (result.Outcome != RequestReviewOutcome.Ok)
        {
            await transaction.RollbackAsync(ct);
            return result.Outcome switch
            {
                RequestReviewOutcome.NotFound => Results.NotFound(new { message = "الطلب غير موجود." }),
                RequestReviewOutcome.Forbidden => Results.Json(new { message = "هذا الطلب خارج نطاقك." },
                    statusCode: StatusCodes.Status403Forbidden),
                RequestReviewOutcome.AlreadyReviewed => Results.Conflict(new { message = "تمت مراجعة هذا الطلب بالفعل." }),
                RequestReviewOutcome.MissingSchedule => Results.ValidationProblem(
                    new Dictionary<string, string[]> { ["request"] = ["بيانات الموعد ناقصة."] }),
                RequestReviewOutcome.MissingAttendance => Results.ValidationProblem(
                    new Dictionary<string, string[]> { ["request"] = ["سجل الحضور غير موجود."] }),
                RequestReviewOutcome.InvalidDuration => Results.ValidationProblem(
                    new Dictionary<string, string[]> { ["durationMinutes"] = ["المدة المقترحة غير صحيحة."] }),
                RequestReviewOutcome.InvalidStatus => Results.ValidationProblem(
                    new Dictionary<string, string[]> { ["status"] = ["حالة الحضور المقترحة غير صحيحة."] }),
                RequestReviewOutcome.InvalidAmount => Results.ValidationProblem(
                    new Dictionary<string, string[]> { ["amount"] = ["تعذر حساب الأجر."] }),
                RequestReviewOutcome.Locked => Results.Conflict(new { message =
                    "مسير رواتب هذا الشهر مقفل. افتح المسير قبل تعديل الحضور أو الأجر." }),
                RequestReviewOutcome.CompletedSessionExists => Results.Conflict(new { message =
                    Dar.Common.Requests.RequestEffectApplier.CompletedSessionMessage }),
                _ => Results.Problem()
            };
        }

        if (result.Type == "correction" && result.Correction is { } correction)
            await TeachingAudit.WriteAsync(connection, transaction, principal, "request.correction.apply",
                "teacher_attendance", result.AttendanceId,
                new { oldDuration = correction.OldDuration, oldStatus = correction.OldStatus,
                    newDuration = correction.NewDuration, newStatus = correction.NewStatus,
                    amount = correction.Amount },
                $"/api/v1/supervisor/requests/{id}/review", "POST", ct);

        await TeachingNotifications.ResolveAsync(connection, transaction, $"request:{id}", reviewer,
            request.Approve ? "تم اعتماد الطلب." : "تم رفض الطلب.", ct);
        await RequestHelpers.NotifyTeacherAsync(connection, transaction, result.TeacherId,
            request.Approve ? "تم اعتماد طلبك" : "تم رفض طلبك",
            request.Approve ? "تمت مراجعة الطلب واعتماده." : $"تم رفض الطلب. {note ?? ""}".Trim(),
            id, $"request-review:{id}", ct);
        await TeachingAudit.WriteAsync(connection, transaction, principal, "request.review",
            "attendance_request", id, new { approved = request.Approve, note },
            $"/api/v1/supervisor/requests/{id}/review", "POST", ct);
        await transaction.CommitAsync(ct);
        return Results.Ok(new { id, status = result.Status });
    }

}
