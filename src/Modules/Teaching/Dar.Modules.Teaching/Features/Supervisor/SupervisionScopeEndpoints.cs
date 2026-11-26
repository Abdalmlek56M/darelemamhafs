using System.Security.Claims;
using Dar.Common.Pagination;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Supervisor;

public sealed record SetSupervisionScopeRequest(Guid[]? CircleIds, Guid[]? TeacherIds);

public static class SupervisionScopeEndpoints
{
    public static async Task<IResult> ListUsers(int? page, int? pageSize, HttpContext http, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var paging = new PageRequest(page, pageSize);
        var paged = page is not null || pageSize is not null;
        var users = new List<object>();
        long total = 0;

        var query = """
            SELECT u.id, u.username, u.display_name,
                   COALESCE(array_agg(s.scope_id) FILTER (WHERE s.scope_type = 'circle'), ARRAY[]::uuid[]) AS circles,
                   COALESCE(array_agg(s.scope_id) FILTER (WHERE s.scope_type = 'teacher'), ARRAY[]::uuid[]) AS teachers,
                   COUNT(*) OVER() AS total
            FROM app_users u
            LEFT JOIN app_user_scopes s ON s.user_id = u.id
            WHERE u.is_active = TRUE
              AND EXISTS (
                  SELECT 1 FROM user_permissions up
                  WHERE up.user_id = u.id AND up.permission_code LIKE 'supervisor.%'
              )
            GROUP BY u.id
            ORDER BY u.display_name, u.id
            """;
        if (paged) query += " LIMIT @take OFFSET @skip";
        await using (var command = new NpgsqlCommand(query, connection))
        {
            if (paged) { command.Parameters.AddWithValue("take", paging.PageSize); command.Parameters.AddWithValue("skip", paging.Offset); }
            await using (var reader = await command.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                {
                    total = reader.ReadTotal();
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
            total = await PaginationRules.EnsureTotalAsync(command, total, paged, ct);
        }

        PaginationHeaderWriter.Write(http.Response, total, paging, users.Count, paged);
        return Results.Ok(new { users, total });
    }

    public static async Task<IResult> Options(int? page, int? pageSize, HttpContext http, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var paging = new PageRequest(page, pageSize);
        var paged = page is not null || pageSize is not null;
        var circles = new List<object>();
        long circlesTotal = 0;
        var query = """
            SELECT c.id, c.name, t.full_name, COUNT(*) OVER() AS total
            FROM circles c
            LEFT JOIN teachers t ON t.id = c.teacher_id AND t.is_trashed = FALSE
            WHERE c.is_trashed = FALSE
            ORDER BY c.name, c.id
            """;
        if (paged) query += " LIMIT @take OFFSET @skip";
        await using (var command = new NpgsqlCommand(query, connection))
        {
            if (paged) { command.Parameters.AddWithValue("take", paging.PageSize); command.Parameters.AddWithValue("skip", paging.Offset); }
            await using (var reader = await command.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                {
                    circlesTotal = reader.ReadTotal();
                    circles.Add(new
                    {
                        id = reader.GetGuid(0),
                        name = reader.GetString(1),
                        teacherName = reader.IsDBNull(2) ? null : reader.GetString(2)
                    });
                }
            }
            circlesTotal = await PaginationRules.EnsureTotalAsync(command, circlesTotal, paged, ct);
        }

        var teachers = new List<object>();
        await using (var command = new NpgsqlCommand("""
            SELECT id, full_name, status
            FROM teachers
            WHERE is_trashed = FALSE
            ORDER BY full_name, id;
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

        PaginationHeaderWriter.Write(http.Response, circlesTotal, paging, circles.Count, paged);
        return Results.Ok(new { circles, teachers, circlesTotal, teachersTotal = teachers.Count });
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
