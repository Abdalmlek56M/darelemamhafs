using System.Security.Claims;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Supervisor;

/// <summary>
/// Resolves the circle/teacher scope of a supervisor or secretary.
/// No scope rows means all circles and teachers. Admins always see all.
/// A circle scope expands to its teacher; a teacher scope expands to their circles.
/// </summary>
public sealed record SupervisionScope(bool All, Guid[] CircleIds, Guid[] TeacherIds)
{
    public static readonly SupervisionScope AllScope = new(true, [], []);

    public bool AllowsCircle(Guid id) => All || CircleIds.Contains(id);
    public bool AllowsTeacher(Guid id) => All || TeacherIds.Contains(id);

    public static async Task<SupervisionScope> LoadAsync(
        NpgsqlConnection connection,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        if (TeachingPrincipal.Has(principal, "users.manage"))
            return AllScope;

        var userId = TeachingPrincipal.UserId(principal);
        if (userId == Guid.Empty)
            return new SupervisionScope(false, [], []);

        var directCircles = new List<Guid>();
        var directTeachers = new List<Guid>();

        await using (var scopes = new NpgsqlCommand("""
            SELECT scope_type, scope_id
            FROM app_user_scopes
            WHERE user_id = @user;
            """, connection))
        {
            scopes.Parameters.AddWithValue("user", userId);
            await using var reader = await scopes.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var id = reader.GetGuid(1);
                if (reader.GetString(0) == "circle") directCircles.Add(id);
                else directTeachers.Add(id);
            }
        }

        if (directCircles.Count == 0 && directTeachers.Count == 0)
            return AllScope;

        var circles = new HashSet<Guid>(directCircles);
        var teachers = new HashSet<Guid>(directTeachers);

        if (teachers.Count > 0)
        {
            await using var expandCircles = new NpgsqlCommand("""
                SELECT id FROM circles
                WHERE is_trashed = FALSE AND teacher_id = ANY(@teachers);
                """, connection);
            expandCircles.Parameters.AddWithValue("teachers", teachers.ToArray());
            await using var reader = await expandCircles.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) circles.Add(reader.GetGuid(0));
        }

        if (circles.Count > 0)
        {
            await using var expandTeachers = new NpgsqlCommand("""
                SELECT DISTINCT teacher_id FROM circles
                WHERE is_trashed = FALSE AND teacher_id IS NOT NULL AND id = ANY(@circles);
                """, connection);
            expandTeachers.Parameters.AddWithValue("circles", circles.ToArray());
            await using var reader = await expandTeachers.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) teachers.Add(reader.GetGuid(0));
        }

        return new SupervisionScope(false, circles.ToArray(), teachers.ToArray());
    }
}
