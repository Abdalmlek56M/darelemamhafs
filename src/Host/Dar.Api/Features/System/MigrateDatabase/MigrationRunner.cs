using System.Security.Cryptography;
using System.Text;
using Npgsql;

namespace Dar.Api.Features.System.MigrateDatabase;

/// <summary>
/// Applies ordered SQL files from database/ with a checksum ledger and an advisory lock.
/// Production never auto-migrates on startup.
/// </summary>
public static class MigrationRunner
{
    private const long AdvisoryLockKey = 9_142_026_001;

    public static async Task<int> RunAsync(IConfiguration configuration, CancellationToken ct = default)
    {
        var connectionString = configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            Console.Error.WriteLine("ConnectionStrings:Default is not configured.");
            return 1;
        }

        var migrationsDirectory = Path.Combine(AppContext.BaseDirectory, "database");
        if (!Directory.Exists(migrationsDirectory))
        {
            Console.Error.WriteLine($"Migrations directory not found: {migrationsDirectory}");
            return 1;
        }

        var files = Directory.GetFiles(migrationsDirectory, "*.sql")
            .OrderBy(Path.GetFileName, StringComparer.Ordinal)
            .ToArray();

        if (files.Length == 0)
        {
            Console.Error.WriteLine("No migration files found.");
            return 1;
        }

        await using var dataSource = NpgsqlDataSource.Create(connectionString);
        await using var connection = await dataSource.OpenConnectionAsync(ct);

        await using (var lockCommand = new NpgsqlCommand("SELECT pg_advisory_lock(@key);", connection))
        {
            lockCommand.Parameters.AddWithValue("key", AdvisoryLockKey);
            await lockCommand.ExecuteNonQueryAsync(ct);
        }

        try
        {
            await EnsureLedgerAsync(connection, ct);
            await AdoptLegacyLedgerAsync(connection, files, ct);

            var applied = 0;
            foreach (var file in files)
            {
                var version = Path.GetFileNameWithoutExtension(file);
                var sql = await File.ReadAllTextAsync(file, ct);
                var checksum = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sql))).ToLowerInvariant();

                var existingChecksum = await GetAppliedChecksumAsync(connection, version, ct);
                if (existingChecksum is not null)
                {
                    if (!string.Equals(existingChecksum, checksum, StringComparison.Ordinal))
                    {
                        Console.Error.WriteLine($"Migration {version} changed after it was applied. Refusing to continue.");
                        return 1;
                    }
                    continue;
                }

                await using var transaction = await connection.BeginTransactionAsync(ct);
                try
                {
                    await using (var apply = new NpgsqlCommand(sql, connection, transaction))
                        await apply.ExecuteNonQueryAsync(ct);

                    await using (var record = new NpgsqlCommand(
                        "INSERT INTO web_schema_migrations(version, checksum) VALUES(@version,@checksum);",
                        connection, transaction))
                    {
                        record.Parameters.AddWithValue("version", version);
                        record.Parameters.AddWithValue("checksum", checksum);
                        await record.ExecuteNonQueryAsync(ct);
                    }

                    await transaction.CommitAsync(ct);
                    applied++;
                    Console.WriteLine($"Applied {version}");
                }
                catch
                {
                    await transaction.RollbackAsync(ct);
                    throw;
                }
            }

            Console.WriteLine(applied == 0
                ? "Database schema is already up to date."
                : $"Applied {applied} migration(s).");
            return 0;
        }
        finally
        {
            await using var unlock = new NpgsqlCommand("SELECT pg_advisory_unlock(@key);", connection);
            unlock.Parameters.AddWithValue("key", AdvisoryLockKey);
            await unlock.ExecuteNonQueryAsync(CancellationToken.None);
        }
    }

    /// <summary>
    /// The legacy desktop app recorded applied migrations in schema_migrations without checksums.
    /// When the new CLI first runs against that database, seed web_schema_migrations from it so
    /// already-applied files are not re-run (and 012 is not replayed on live timetable data).
    /// </summary>
    private static async Task AdoptLegacyLedgerAsync(
        NpgsqlConnection connection,
        string[] files,
        CancellationToken ct)
    {
        await using (var count = new NpgsqlCommand("SELECT COUNT(*) FROM web_schema_migrations;", connection))
        {
            if (Convert.ToInt64(await count.ExecuteScalarAsync(ct)) > 0) return;
        }

        await using (var exists = new NpgsqlCommand("SELECT to_regclass('public.schema_migrations') IS NOT NULL;", connection))
        {
            if (!(bool)(await exists.ExecuteScalarAsync(ct) ?? false)) return;
        }

        var legacyVersions = new List<string>();
        await using (var read = new NpgsqlCommand("SELECT version FROM schema_migrations ORDER BY version;", connection))
        await using (var reader = await read.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct)) legacyVersions.Add(reader.GetString(0));
        }

        var adopted = 0;
        foreach (var version in legacyVersions)
        {
            var file = files.FirstOrDefault(candidate =>
                string.Equals(Path.GetFileNameWithoutExtension(candidate), version, StringComparison.Ordinal));
            if (file is null)
                throw new InvalidOperationException(
                    $"Legacy migration ledger contains '{version}', but no matching SQL file exists. Refusing to guess.");

            var sql = await File.ReadAllTextAsync(file, ct);
            var checksum = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sql))).ToLowerInvariant();
            await using var insert = new NpgsqlCommand(
                "INSERT INTO web_schema_migrations(version, checksum) VALUES(@version,@checksum) ON CONFLICT (version) DO NOTHING;",
                connection);
            insert.Parameters.AddWithValue("version", version);
            insert.Parameters.AddWithValue("checksum", checksum);
            adopted += await insert.ExecuteNonQueryAsync(ct);
        }

        if (adopted > 0)
            Console.WriteLine($"Adopted {adopted} migration(s) from the legacy schema_migrations ledger.");
    }

    private static async Task EnsureLedgerAsync(NpgsqlConnection connection, CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("""
            CREATE TABLE IF NOT EXISTS web_schema_migrations (
                version VARCHAR(120) PRIMARY KEY,
                checksum VARCHAR(64) NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            """, connection);
        await command.ExecuteNonQueryAsync(ct);
    }

    private static async Task<string?> GetAppliedChecksumAsync(
        NpgsqlConnection connection,
        string version,
        CancellationToken ct)
    {
        await using var command = new NpgsqlCommand(
            "SELECT checksum FROM web_schema_migrations WHERE version=@version;", connection);
        command.Parameters.AddWithValue("version", version);
        return await command.ExecuteScalarAsync(ct) as string;
    }
}
