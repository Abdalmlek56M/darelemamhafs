using System.Globalization;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

/// <summary>
/// The single writer for the append-only <c>audit_log</c> table. Every explicit audit event uses this
/// helper so the column list, parameter typing and JSON nullability can never drift between
/// endpoints. Rows written here may later be enriched by <see cref="AuditMiddleware"/> when the same
/// request also passes through that middleware.
/// </summary>
public static class AuditLogWriter
{
    /// <summary>
    /// One parameterized statement covering the full audit_log column list. <c>details</c> is always
    /// a jsonb object ('{}' when the caller passes no payload), before/after snapshots stay NULL when
    /// the caller captured none, and can_restore defaults to FALSE.
    /// </summary>
    private const string InsertSql = """
        INSERT INTO audit_log(actor_user_id,actor_display_name,action_code,entity_type,entity_id,details,before_data,after_data,request_path,http_method,can_restore)
        VALUES(@actor,@actorName,@action,@entityType,@entityId,@details::jsonb,@before::jsonb,@after::jsonb,@requestPath,@httpMethod,@canRestore)
        RETURNING id;
        """;

    /// <summary>
    /// Writes one audit row on the caller's connection (and transaction when supplied, which keeps
    /// financial audit rows atomic with the money write) and returns the new audit row id.
    /// </summary>
    public static async Task<long> WriteAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        Guid? actorId,
        string? actorDisplayName,
        string actionCode,
        string entityType,
        Guid? entityId,
        string? detailsJson = null,
        string? beforeJson = null,
        string? afterJson = null,
        string? requestPath = null,
        string? httpMethod = null,
        bool canRestore = false,
        CancellationToken cancellationToken = default)
    {
        await using var command = new NpgsqlCommand(InsertSql, connection, transaction);
        Bind(command, actorId, actorDisplayName, actionCode, entityType, entityId,
            detailsJson, beforeJson, afterJson, requestPath, httpMethod, canRestore);
        return await ExecuteAsync(command, cancellationToken);
    }

    /// <summary>Writes one audit row on a pooled connection outside an explicit transaction.</summary>
    public static async Task<long> WriteAsync(
        NpgsqlDataSource dataSource,
        Guid? actorId,
        string? actorDisplayName,
        string actionCode,
        string entityType,
        Guid? entityId,
        string? detailsJson = null,
        string? beforeJson = null,
        string? afterJson = null,
        string? requestPath = null,
        string? httpMethod = null,
        bool canRestore = false,
        CancellationToken cancellationToken = default)
    {
        await using var command = dataSource.CreateCommand(InsertSql);
        Bind(command, actorId, actorDisplayName, actionCode, entityType, entityId,
            detailsJson, beforeJson, afterJson, requestPath, httpMethod, canRestore);
        return await ExecuteAsync(command, cancellationToken);
    }

    private static async Task<long> ExecuteAsync(NpgsqlCommand command, CancellationToken cancellationToken) =>
        Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture);

    private static void Bind(
        NpgsqlCommand command,
        Guid? actorId,
        string? actorDisplayName,
        string actionCode,
        string entityType,
        Guid? entityId,
        string? detailsJson,
        string? beforeJson,
        string? afterJson,
        string? requestPath,
        string? httpMethod,
        bool canRestore)
    {
        command.Parameters.Add("actor", NpgsqlDbType.Uuid).Value = actorId is Guid actor ? actor : DBNull.Value;
        // Keep NULL vs empty-string actor names exactly as each caller supplied them.
        command.Parameters.Add("actorName", NpgsqlDbType.Text).Value = (object?)actorDisplayName ?? DBNull.Value;
        command.Parameters.Add("action", NpgsqlDbType.Text).Value = actionCode;
        command.Parameters.Add("entityType", NpgsqlDbType.Text).Value = entityType;
        command.Parameters.Add("entityId", NpgsqlDbType.Uuid).Value = entityId is Guid entity ? entity : DBNull.Value;
        // details is NOT NULL jsonb: callers that pass no payload get the same '{}' the old helpers wrote.
        command.Parameters.Add("details", NpgsqlDbType.Text).Value = detailsJson ?? "{}";
        command.Parameters.Add("before", NpgsqlDbType.Text).Value = (object?)beforeJson ?? DBNull.Value;
        command.Parameters.Add("after", NpgsqlDbType.Text).Value = (object?)afterJson ?? DBNull.Value;
        command.Parameters.Add("requestPath", NpgsqlDbType.Text).Value = (object?)requestPath ?? DBNull.Value;
        command.Parameters.Add("httpMethod", NpgsqlDbType.Text).Value = (object?)httpMethod ?? DBNull.Value;
        command.Parameters.Add("canRestore", NpgsqlDbType.Boolean).Value = canRestore;
    }
}
