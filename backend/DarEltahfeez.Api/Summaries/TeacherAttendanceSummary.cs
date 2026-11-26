using Npgsql;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    internal static void MapTeacherAttendanceSummary(WebApplication app)
    {
        app.MapGet("/api/summary/teacher-attendance", async Task<IResult> (string? month, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (!TryMonth(month, out var from))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["month"] = ["حدد الشهر بصيغة YYYY-MM."] });
            var to = from.AddMonths(1);
            await using var cmd = db.CreateCommand("""
                SELECT COUNT(*),
                       COUNT(*) FILTER (WHERE a.status='present'),
                       COALESCE(SUM(a.duration_minutes) FILTER (WHERE a.status='present'),0),
                       COALESCE(SUM(a.payable_amount) FILTER (WHERE a.status='present'),0)
                FROM teacher_attendance a JOIN circles c ON c.id=a.circle_id
                WHERE a.session_date>=@from AND a.session_date<@to AND a.is_trashed=FALSE AND c.is_trashed=FALSE;
                """);
            cmd.Parameters.AddWithValue("from", from);
            cmd.Parameters.AddWithValue("to", to);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            return Results.Ok(new
            {
                billingMonth = from.ToString("yyyy-MM"),
                sessionCount = reader.GetInt64(0),
                presentCount = reader.GetInt64(1),
                payableMinutes = reader.GetInt64(2),
                payableAmount = reader.GetDecimal(3)
            });
        }).RequireAuthorization("attendance.access");
    }
}
