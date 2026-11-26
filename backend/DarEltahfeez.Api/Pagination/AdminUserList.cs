using Dar.Common.Pagination;
using Npgsql;

namespace DarEltahfeez.Api;

public static partial class AuthEndpoints
{
    internal static async Task<IResult> LoadAdminUsersAsync(
        int? page, int? pageSize, HttpContext http, NpgsqlDataSource db, CancellationToken ct)
    {
        var paging = new PageRequest(page, pageSize);
        var paged = page is not null || pageSize is not null;
        var query = """
            SELECT id, username, display_name, is_active, is_locked, teacher_id, lock_reason, created_at,
                   COALESCE((SELECT array_agg(scope_id) FROM app_user_scopes s
                             WHERE s.user_id = app_users.id AND s.scope_type = 'circle'), ARRAY[]::uuid[]) AS scope_circles,
                   COALESCE((SELECT array_agg(scope_id) FROM app_user_scopes s
                             WHERE s.user_id = app_users.id AND s.scope_type = 'teacher'), ARRAY[]::uuid[]) AS scope_teachers,
                   COUNT(*) OVER() AS total
            FROM app_users
            ORDER BY created_at, username, id
            """;
        if (paged) query += " LIMIT @take OFFSET @skip";
        await using var cmd = db.CreateCommand(query);
        if (paged)
        {
            cmd.Parameters.AddWithValue("take", paging.PageSize);
            cmd.Parameters.AddWithValue("skip", paging.Offset);
        }
        var list = new List<AdminUserResponse>();
        long total = 0;
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            total = reader.ReadTotal();
            list.Add(new AdminUserResponse(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetBoolean(3),
                reader.GetBoolean(4),
                reader.IsDBNull(5) ? null : reader.GetGuid(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.GetFieldValue<DateTimeOffset>(7),
                [],
                reader.GetFieldValue<Guid[]>(8),
                reader.GetFieldValue<Guid[]>(9)));
        }
        await reader.DisposeAsync();
        total = await PaginationRules.EnsureTotalAsync(cmd, total, paged, ct);
        foreach (var user in list)
            user.PermissionCodes = await LoadPermissions(db, user.Id, ct);
        PaginationHeaderWriter.Write(http.Response, total, paging, list.Count, paged);
        return Results.Ok(list);
    }
}
