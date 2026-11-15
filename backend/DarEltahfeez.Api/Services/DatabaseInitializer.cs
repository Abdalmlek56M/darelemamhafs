using Npgsql;

namespace DarEltahfeez.Api.Services;

public static class DatabaseInitializer
{
    public static async Task<IReadOnlyList<string>> ApplyMigrationsAsync(
        NpgsqlDataSource dataSource,
        string migrationsDirectory,
        CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(migrationsDirectory))
        {
            throw new DirectoryNotFoundException(
                $"لم يتم العثور على مجلد ترحيلات قاعدة البيانات: {migrationsDirectory}");
        }

        var migrationFiles = Directory.GetFiles(migrationsDirectory, "*.sql")
            .OrderBy(Path.GetFileName, StringComparer.Ordinal)
            .ToArray();
        if (migrationFiles.Length == 0)
        {
            throw new InvalidOperationException("مجلد ترحيلات قاعدة البيانات لا يحتوي على ملفات SQL.");
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using (var migrationTable = new NpgsqlCommand(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(120) PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            """, connection))
        {
            await migrationTable.ExecuteNonQueryAsync(cancellationToken);
        }

        var applied = new List<string>();
        foreach (var file in migrationFiles)
        {
            var version = Path.GetFileNameWithoutExtension(file);
            var schemaSql = await File.ReadAllTextAsync(file, cancellationToken);

            await using (var check = new NpgsqlCommand(
                "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = @version);", connection))
            {
                check.Parameters.AddWithValue("version", version);
                var alreadyApplied = (bool)(await check.ExecuteScalarAsync(cancellationToken) ?? false);
                if (alreadyApplied) continue;
            }

            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            try
            {
                await using (var apply = new NpgsqlCommand(schemaSql, connection, transaction))
                {
                    await apply.ExecuteNonQueryAsync(cancellationToken);
                }

                await using (var record = new NpgsqlCommand(
                    "INSERT INTO schema_migrations(version) VALUES (@version);", connection, transaction))
                {
                    record.Parameters.AddWithValue("version", version);
                    await record.ExecuteNonQueryAsync(cancellationToken);
                }

                await transaction.CommitAsync(cancellationToken);
                applied.Add(version);
            }
            catch
            {
                await transaction.RollbackAsync(cancellationToken);
                throw;
            }
        }

        return applied;
    }
}
