using System.Security.Claims;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Supervisor;

public sealed record SetSupervisionScopeRequest(Guid[]? CircleIds, Guid[]? TeacherIds);

public static class SupervisionScopeEndpoints
{
    public static async Task<IResult> ListUsers(NpgsqlDataSource dataSource, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var users = new List<object>();

        await using (var command = new NpgsqlCommand("""
            SELECT u.id, u.username, u.display_name,
                   COALESCE(array_agg(s.scope_id) FILTER (WHERE s.scope_type = 'circle'), ARRAY[]::uuid[]) AS circles,
                   COALESCE(array_agg(s.scope_id) FILTER (WHERE s.scope_type = 'teacher'), ARRAY[]::uuid[]) AS teachers
            FROM app_users u
            LEFT JOIN app_user_scopes s ON s.user_id = u.id
            WHERE u.is_active = TRUE
              AND EXISTS (
                  SELECT 1 FROM user_permissions up
                  WHERE up.user_id = u.id AND up.permission_code LIKE 'supervisor.%'
              )
            GROUP BY u.id
            ORDER BY u.display_name;
            """, connection))
        {
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var circles = reader.GetFieldValue<Guid[]>(3);
                var teachers = reader.GetFieldValue<Guid[]>(4);
                users.Add(new
                {
                    userId = reader.GetGuid(0),
                    username = reader.GetString(1),
                    displayName = reader.GetString(2),
                    circleIds = circles,
                    teacherIds = teachers,
                    all = circles.Length == 0 && teachers.Length == 0
                });
            }
        }

        return Results.Ok(new { users });
    }

    public static async Task<IResult> Options(NpgsqlDataSource dataSource, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var circles = new List<object>();
        await using (var command = new NpgsqlCommand("""
            SELECT c.id, c.name, t.full_name
            FROM circles c
            LEFT JOIN teachers t ON t.id = c.teacher_id AND t.is_trashed = FALSE
            WHERE c.is_trashed = FALSE
            ORDER BY c.name;
            """, connection))
        {
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                circles.Add(new
                {
                    id = reader.GetGuid(0),
                    name = reader.GetString(1),
                    teacherName = reader.IsDBNull(2) ? null : reader.GetString(2)
                });
        }

        var teachers = new List<object>();
        await using (var command = new NpgsqlCommand("""
            SELECT id, full_name, status
            FROM teachers
            WHERE is_trashed = FALSE
            ORDER BY full_name;
            """, connection))
        {
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                teachers.Add(new
                {
                    id = reader.GetGuid(0),
                    fullName = reader.GetString(1),
                    status = reader.GetString(2)
                });
        }

        return Results.Ok(new { circles, teachers });
    }

    public static async Task<IResult> Set(
        Guid id,
        SetSupervisionScopeRequest request,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var circleIds = (request.CircleIds ?? []).Distinct().ToArray();
        var teacherIds = (request.TeacherIds ?? []).Distinct().ToArray();

        await using var connection = await dataSource.OpenConnectionAsync(ct);

        await using (var user = new NpgsqlCommand("""
            SELECT EXISTS(SELECT 1 FROM app_users WHERE id = @id AND is_active = TRUE);
            """, connection))
        {
            user.Parameters.AddWithValue("id", id);
            if (!(bool)(await user.ExecuteScalarAsync(ct) ?? false))
                return Results.NotFound(new { message = "الحساب غير موجود." });
        }

        if (circleIds.Length > 0)
        {
            await using var valid = new NpgsqlCommand("""
                SELECT COUNT(*) FROM circles WHERE id = ANY(@ids) AND is_trashed = FALSE;
                """, connection);
            valid.Parameters.AddWithValue("ids", circleIds);
            if (Convert.ToInt32(await valid.ExecuteScalarAsync(ct) ?? 0) != circleIds.Length)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["circleIds"] = ["بعض الحلقات غير موجودة."] });
        }

        if (teacherIds.Length > 0)
        {
            await using var valid = new NpgsqlCommand("""
                SELECT COUNT(*) FROM teachers WHERE id = ANY(@ids) AND is_trashed = FALSE;
                """, connection);
            valid.Parameters.AddWithValue("ids", teacherIds);
            if (Convert.ToInt32(await valid.ExecuteScalarAsync(ct) ?? 0) != teacherIds.Length)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["teacherIds"] = ["بعض المعلمات غير موجودة."] });
        }

        await using var transaction = await connection.BeginTransactionAsync(ct);
        await using (var clear = new NpgsqlCommand("DELETE FROM app_user_scopes WHERE user_id = @user;", connection, transaction))
        {
            clear.Parameters.AddWithValue("user", id);
            await clear.ExecuteNonQueryAsync(ct);
        }

        foreach (var circle in circleIds)
        {
            await using var insert = new NpgsqlCommand("""
                INSERT INTO app_user_scopes(user_id, scope_type, scope_id, created_by)
                VALUES (@user, 'circle', @scope, @actor);
                """, connection, transaction);
            insert.Parameters.AddWithValue("user", id);
            insert.Parameters.AddWithValue("scope", circle);
            insert.Parameters.AddWithValue("actor", TeachingPrincipal.UserId(principal));
            await insert.ExecuteNonQueryAsync(ct);
        }

        foreach (var teacher in teacherIds)
        {
            await using var insert = new NpgsqlCommand("""
                INSERT INTO app_user_scopes(user_id, scope_type, scope_id, created_by)
                VALUES (@user, 'teacher', @scope, @actor);
                """, connection, transaction);
            insert.Parameters.AddWithValue("user", id);
            insert.Parameters.AddWithValue("scope", teacher);
            insert.Parameters.AddWithValue("actor", TeachingPrincipal.UserId(principal));
            await insert.ExecuteNonQueryAsync(ct);
        }

        await TeachingAudit.WriteAsync(connection, transaction, principal, "supervisor.scope.set", "app_user", id,
            new { circleIds, teacherIds, all = circleIds.Length == 0 && teacherIds.Length == 0 },
            $"/api/v1/supervisor/scopes/{id}", "PUT", ct);
        await transaction.CommitAsync(ct);

        return Results.Ok(new
        {
            userId = id,
            circleIds,
            teacherIds,
            all = circleIds.Length == 0 && teacherIds.Length == 0
        });
    }
}
