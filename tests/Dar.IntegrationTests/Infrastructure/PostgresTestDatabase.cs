using Npgsql;

namespace Dar.IntegrationTests.Infrastructure;

/// <summary>
/// Applies every ordered SQL file in database/ to a disposable PostgreSQL instance.
/// Used by integration fixtures that need the production-like schema (including the
/// timetable overlap guards).
/// </summary>
internal static class PostgresTestDatabase
{
    public static async Task ApplyMigrationsAsync(string connectionString, CancellationToken cancellationToken)
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !Directory.Exists(Path.Combine(root.FullName, "database")))
            root = root.Parent;
        if (root is null) throw new InvalidOperationException("database folder not found from the test output directory.");

        var migrations = Directory
            .GetFiles(Path.Combine(root.FullName, "database"), "*.sql")
            .OrderBy(Path.GetFileName, StringComparer.Ordinal);

        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        foreach (var migration in migrations)
        {
            var sql = await File.ReadAllTextAsync(migration, cancellationToken);
            await using var command = new NpgsqlCommand(sql, connection);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
    }
}
