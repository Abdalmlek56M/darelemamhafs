using System.Security.Claims;
using System.Text.Json;
using Npgsql;

namespace Dar.Modules.Meet.Application;

public static class MeetPrincipal
{
    public static Guid UserId(ClaimsPrincipal principal) =>
        Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : Guid.Empty;

    public static string DisplayName(ClaimsPrincipal principal) =>
        principal.FindFirstValue("display_name") ?? principal.FindFirstValue(ClaimTypes.Name) ?? "مستخدم";
}

/// <summary>Append-only audit for every meet mutation (docs/03-security.md).</summary>
public static class MeetAudit
{
    public static async Task WriteAsync(
        NpgsqlDataSource dataSource,
        ClaimsPrincipal principal,
        string actionCode,
        string entityType,
        Guid entityId,
        object details,
        string path,
        string method,
        CancellationToken ct,
        Guid? actorIdOverride = null,
        string? actorName = null)
    {
        var actorId = actorIdOverride ?? MeetPrincipal.UserId(principal);
        if (actorId == Guid.Empty) return;
        var displayName = actorName ?? MeetPrincipal.DisplayName(principal);

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await using (var command = new NpgsqlCommand("""
            INSERT INTO audit_log(actor_user_id, actor_display_name, action_code, entity_type, entity_id,
                                  details, request_path, http_method, can_restore)
            VALUES (@actor, @name, @action, @type, @id, @details::jsonb, @path, @method, FALSE);
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("actor", actorId);
            command.Parameters.AddWithValue("name", displayName);
            command.Parameters.AddWithValue("action", actionCode);
            command.Parameters.AddWithValue("type", entityType);
            command.Parameters.AddWithValue("id", entityId);
            command.Parameters.AddWithValue("details", JsonSerializer.Serialize(details));
            command.Parameters.AddWithValue("path", path);
            command.Parameters.AddWithValue("method", method);
            await command.ExecuteNonQueryAsync(ct);
        }

        await transaction.CommitAsync(ct);
    }
}
