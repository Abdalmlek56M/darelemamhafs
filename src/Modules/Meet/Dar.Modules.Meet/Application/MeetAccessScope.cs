using System.Security.Claims;
using Npgsql;

namespace Dar.Modules.Meet.Application;

/// <summary>
/// Circle scope for calendar/recording data. Mirrors the supervision scope rules:
/// admins (users.manage) see everything, and a user without scope rows sees everything.
/// A restricted user only sees occurrences linked to their circles.
/// </summary>
public sealed record MeetAccessScope(bool All, Guid[] CircleIds)
{
    public static readonly MeetAccessScope AllScope = new(true, []);

    public bool AllowsCircle(Guid? circleId) =>
        All || (circleId is { } id && CircleIds.Contains(id));

    public static async Task<MeetAccessScope> LoadAsync(
        NpgsqlDataSource dataSource,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        if (principal.HasClaim("permission", "users.manage")) return AllScope;

        var userId = MeetPrincipal.UserId(principal);
        if (userId == Guid.Empty) return new MeetAccessScope(false, []);

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var directCircles = new List<Guid>();
        var directTeachers = new List<Guid>();

        await using (var command = new NpgsqlCommand("""
            SELECT scope_type, scope_id FROM app_user_scopes WHERE user_id = @user;
            """, connection))
        {
            command.Parameters.AddWithValue("user", userId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                if (reader.GetString(0) == "circle") directCircles.Add(reader.GetGuid(1));
                else directTeachers.Add(reader.GetGuid(1));
            }
        }

        if (directCircles.Count == 0 && directTeachers.Count == 0) return AllScope;

        var circles = new HashSet<Guid>(directCircles);
        if (directTeachers.Count > 0)
        {
            await using var expand = new NpgsqlCommand("""
                SELECT id FROM circles
                WHERE is_trashed = FALSE AND teacher_id = ANY(@teachers);
                """, connection);
            expand.Parameters.AddWithValue("teachers", directTeachers.ToArray());
            await using var reader = await expand.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) circles.Add(reader.GetGuid(0));
        }

        return new MeetAccessScope(false, circles.ToArray());
    }
}
