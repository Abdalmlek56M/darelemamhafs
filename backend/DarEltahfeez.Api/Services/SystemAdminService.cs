using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Npgsql;

namespace DarEltahfeez.Api.Services;

public sealed record BackupCreatedResult(Guid Id, string FileName, string ScopeCodes, long SizeBytes, DateTimeOffset CreatedAt);

/// <summary>
/// Infrastructure operations for the internal administration console. All dynamic SQL identifiers
/// are selected from fixed allow-lists; user input is never used as a table or column name.
/// </summary>
public sealed class SystemAdminService(NpgsqlDataSource dataSource, ILogger<SystemAdminService> logger, IConfiguration configuration)
{
    public static readonly IReadOnlyDictionary<string, string> TrashTables = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["student"] = "students", ["teacher"] = "teachers", ["circle"] = "circles",
        ["student-note"] = "student_notes", ["teacher-note"] = "teacher_notes", ["student-attendance"] = "student_attendance", ["enrollment"] = "circle_enrollments",
        ["monthly-charge"] = "monthly_charges", ["payment"] = "payments",
        ["collection-report"] = "collection_reports", ["schedule-slot"] = "circle_schedule_slots",
        ["teacher-attendance"] = "teacher_attendance", ["advertising-expense"] = "advertising_expenses",
        ["operating-expense"] = "operating_expenses"
    };

    /// <summary>
    /// Financial and historical records may be soft-deleted for correction, but never purged.
    /// A correction must be an explicit void/reversal so balances remain explainable.
    /// </summary>
    public static readonly IReadOnlySet<string> FinancialTrashTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "payment", "monthly-charge", "teacher-attendance", "student-attendance",
        "enrollment", "collection-report", "advertising-expense", "operating-expense"
    };

    private static readonly IReadOnlyDictionary<string, string[]> BackupTables = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
    {
        ["students"] = ["students", "student_notes", "circle_enrollments", "monthly_charges", "payments", "student_attendance"],
        ["teachers"] = ["teachers", "teacher_notes", "teacher_attendance"],
        ["circles"] = ["circles", "circle_schedule_slots", "circle_enrollments", "monthly_charges", "payments", "teacher_attendance", "student_attendance", "advertising_expenses", "operating_expenses"],
        ["finance"] = ["monthly_charges", "payments", "advertising_expenses", "operating_expenses", "collection_reports"],
        ["schedule"] = ["circle_schedule_slots", "teacher_attendance", "student_attendance"],
        ["admin"] = ["app_users", "permissions", "user_permissions", "audit_log", "school_settings", "trash_items", "system_backups"]
    };

    /// <summary>
    /// Audit restore is intentionally limited to descriptive profile fields.
    /// Money, attendance, enrollment lifecycle, schedule assignments, and trash flags are
    /// excluded: correcting those requires a reversal/void entry, never a history rewrite.
    /// Removing a table here also removes its "restore previous values" button because
    /// AuditMiddleware derives can_restore from this dictionary.
    /// </summary>
    internal static readonly IReadOnlyDictionary<string, string[]> RestoreColumns = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
    {
        ["students"] = ["student_code", "full_name", "age_years", "phone", "guardian_name", "guardian_phone", "joined_on", "status", "notes"],
        ["teachers"] = ["teacher_code", "full_name", "phone", "status", "notes"],
        ["circles"] = ["circle_code", "name", "schedule_text"],
        ["student_notes"] = ["note_text"],
        ["teacher_notes"] = ["note_text"]
    };

    private string BackupRoot
    {
        get
        {
            var localRoot = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrWhiteSpace(localRoot)) localRoot = AppContext.BaseDirectory;
            var darRoot = Path.GetFullPath(Path.Combine(localRoot, "DarEltahfeez"));
            var defaultFolder = Path.Combine(darRoot, "Backups");
            var configPath = Path.Combine(darRoot, "storage-locations.json");
            var path = defaultFolder;

            // Match the PowerShell Storage Center's active backup folder. If a config exists
            // but is malformed, fail closed rather than silently writing to the old default.
            if (File.Exists(configPath))
            {
                using var document = JsonDocument.Parse(File.ReadAllText(configPath, Encoding.UTF8));
                var element = document.RootElement;
                if (!element.TryGetProperty("SchemaVersion", out var schema) || schema.GetInt32() != 1 ||
                    !element.TryGetProperty("BackupFolder", out var folderValue) || folderValue.ValueKind != JsonValueKind.String)
                    throw new InvalidOperationException("إعداد مسار النسخ الاحتياطي غير صالح؛ لم يتم الرجوع إلى المسار الافتراضي.");
                var configured = folderValue.GetString();
                if (string.IsNullOrWhiteSpace(configured) || !Path.IsPathRooted(configured) || configured.StartsWith("\\", StringComparison.Ordinal))
                    throw new InvalidOperationException("المسار المخصص للنسخ الاحتياطي غير صالح أو شبكي.");
                path = Path.GetFullPath(configured);
                var driveRoot = Path.GetPathRoot(path);
                var leaf = Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
                var isDefaultFolder = string.Equals(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), defaultFolder.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);
                if (string.IsNullOrWhiteSpace(driveRoot) || driveRoot.Length != 3 || driveRoot[1] != ':' ||
                    leaf is not ("Backups" or "DarEltahfeez-Backups") ||
                    (!isDefaultFolder && (IsSameOrChildPath(path, darRoot) || IsSameOrChildPath(darRoot, path))))
                    throw new InvalidOperationException("المسار المخصص للنسخ الاحتياطي لا يطابق قواعد Storage Center الآمنة.");
            }

            Directory.CreateDirectory(path);
            return path;
        }
    }

    private static bool IsSameOrChildPath(string candidate, string parent)
    {
        var candidateFull = Path.GetFullPath(candidate).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var parentFull = Path.GetFullPath(parent).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return string.Equals(candidateFull, parentFull, StringComparison.OrdinalIgnoreCase) ||
               candidateFull.StartsWith(parentFull + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
               candidateFull.StartsWith(parentFull + Path.AltDirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    private async Task WriteFullBackupManifestAsync(string filePath, string databaseName, string pgRestorePath, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var versionCommand = new NpgsqlCommand("SHOW server_version_num;", connection);
        var versionNumber = Convert.ToInt32(await versionCommand.ExecuteScalarAsync(ct), System.Globalization.CultureInfo.InvariantCulture);
        var postgresMajor = versionNumber / 10000;
        if (postgresMajor != 17) throw new InvalidOperationException("لا يمكن اعتماد Manifest لنسخة PostgreSQL خارج الإصدار 17.");

        var validationStart = new ProcessStartInfo
        {
            FileName = pgRestorePath,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = Path.GetDirectoryName(filePath) ?? AppContext.BaseDirectory
        };
        validationStart.ArgumentList.Add("--list");
        validationStart.ArgumentList.Add(filePath);
        using (var validation = new Process { StartInfo = validationStart })
        {
            if (!validation.Start()) throw new InvalidOperationException("تعذر تشغيل pg_restore للتحقق من النسخة الكاملة.");
            var stdoutTask = validation.StandardOutput.ReadToEndAsync(ct);
            var stderrTask = validation.StandardError.ReadToEndAsync(ct);
            await validation.WaitForExitAsync(ct);
            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            if (validation.ExitCode != 0 || string.IsNullOrWhiteSpace(stdout))
                throw new InvalidOperationException(string.IsNullOrWhiteSpace(stderr) ? "فشل pg_restore --list؛ لم يتم اعتماد النسخة الكاملة." : stderr.Trim());
        }

        var file = new FileInfo(filePath);
        await using var stream = File.OpenRead(filePath);
        var sha256 = Convert.ToHexString(await SHA256.HashDataAsync(stream, ct)).ToLowerInvariant();
        var manifest = new
        {
            SchemaVersion = 1,
            Status = "completed",
            FileName = file.Name,
            CreatedAtUtc = DateTimeOffset.UtcNow.ToString("o", System.Globalization.CultureInfo.InvariantCulture),
            ComputerName = Environment.MachineName,
            DatabaseName = databaseName,
            PostgreSqlMajorVersion = postgresMajor,
            ArchiveFormat = "PostgreSQL Custom",
            Validation = "pg_restore --list passed",
            FileSizeBytes = file.Length,
            Sha256 = sha256
        };
        var manifestPath = filePath + ".json";
        var temporaryPath = manifestPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            var json = JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(temporaryPath, json, new UTF8Encoding(false), ct);
            File.Move(temporaryPath, manifestPath, overwrite: false);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
    }

    public async Task<BackupCreatedResult> CreateBackupAsync(IEnumerable<string> requestedScopes, Guid? actorId, string? actorName, CancellationToken ct)
    {
        var scopes = requestedScopes.Select(x => x.Trim().ToLowerInvariant()).Where(x => x.Length > 0).Distinct().ToArray();
        if (scopes.Length == 0) scopes = ["all"];
        if (scopes.Contains("all", StringComparer.OrdinalIgnoreCase)) scopes = ["all"];
        var allScope = scopes.Length == 1 && scopes[0] == "all";
        if (!allScope && scopes.Any(x => !BackupTables.ContainsKey(x)))
            throw new ArgumentException("اختر قسمًا صحيحًا للنسخ الاحتياطي.");

        var tables = allScope ? [] : scopes.SelectMany(s => BackupTables[s]).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var scopeLabel = allScope ? "all" : string.Join(',', scopes.OrderBy(x => x, StringComparer.Ordinal));
        var timestamp = DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmss");
        var fileName = $"DarEltahfeez_{scopeLabel.Replace(',', '-')}_{timestamp}.backup";
        var filePath = Path.Combine(BackupRoot, fileName);
        var id = Guid.NewGuid();
        await using (var insert = dataSource.CreateCommand("INSERT INTO system_backups(id,backup_file_name,backup_path,scope_codes,status,created_by,created_by_name) VALUES(@id,@name,@path,@scope,'running',@actor,@actorName);"))
        {
            insert.Parameters.AddWithValue("id", id); insert.Parameters.AddWithValue("name", fileName); insert.Parameters.AddWithValue("path", filePath);
            insert.Parameters.AddWithValue("scope", scopeLabel); insert.Parameters.AddWithValue("actor", (object?)actorId ?? DBNull.Value);
            insert.Parameters.AddWithValue("actorName", (object?)actorName ?? DBNull.Value);
            await insert.ExecuteNonQueryAsync(ct);
        }

        var archiveCreatedByThisRequest = false;
        var manifestCreatedByThisRequest = false;
        try
        {
            var connection = new NpgsqlConnectionStringBuilder(configuration.GetConnectionString("DarDatabase"));
            var pgBin = Environment.GetEnvironmentVariable("DAR_POSTGRES_BIN");
            if (string.IsNullOrWhiteSpace(pgBin))
            {
                var localRuntime = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DarEltahfeez", "Runtime", "PostgreSQL", "17");
                var candidates = new[] { Path.Combine(localRuntime, "bin"), Path.Combine(localRuntime, "pgsql", "bin") };
                pgBin = candidates.FirstOrDefault(path => File.Exists(Path.Combine(path, "pg_dump.exe")));
            }
            var pgDumpPath = !string.IsNullOrWhiteSpace(pgBin) ? Path.Combine(pgBin, "pg_dump.exe") : "pg_dump.exe";
            if (Path.IsPathRooted(pgDumpPath) && !File.Exists(pgDumpPath))
                throw new InvalidOperationException("لم يتم العثور على pg_dump المرفق مع محرك قاعدة البيانات المحلي.");
            var pgRestorePath = !string.IsNullOrWhiteSpace(pgBin) ? Path.Combine(pgBin, "pg_restore.exe") : "pg_restore.exe";
            if (Path.IsPathRooted(pgRestorePath) && !File.Exists(pgRestorePath))
                throw new InvalidOperationException("لم يتم العثور على pg_restore للتحقق من النسخة الاحتياطية الكاملة.");

            var databaseHost = connection.Host;
            var databaseUser = connection.Username;
            var databaseName = connection.Database;
            var databasePassword = connection.Password;
            if (string.IsNullOrWhiteSpace(databaseHost) || string.IsNullOrWhiteSpace(databaseUser) ||
                string.IsNullOrWhiteSpace(databaseName) || string.IsNullOrWhiteSpace(databasePassword))
                throw new InvalidOperationException("إعدادات اتصال قاعدة البيانات غير مكتملة؛ لم يتم إنشاء نسخة احتياطية.");

            var start = new ProcessStartInfo
            {
                FileName = pgDumpPath, UseShellExecute = false, RedirectStandardOutput = true,
                RedirectStandardError = true, CreateNoWindow = true, WorkingDirectory = BackupRoot
            };
            start.Environment["PGPASSWORD"] = databasePassword;
            start.ArgumentList.Add("--host"); start.ArgumentList.Add(databaseHost);
            start.ArgumentList.Add("--port"); start.ArgumentList.Add(connection.Port.ToString(System.Globalization.CultureInfo.InvariantCulture));
            start.ArgumentList.Add("--username"); start.ArgumentList.Add(databaseUser);
            start.ArgumentList.Add("--dbname"); start.ArgumentList.Add(databaseName);
            start.ArgumentList.Add("--format=custom");
            start.ArgumentList.Add("--no-owner"); start.ArgumentList.Add("--no-privileges");
            if (!allScope)
            {
                start.ArgumentList.Add("--data-only");
                foreach (var table in tables) start.ArgumentList.Add($"--table=public.{table}");
            }

            using var process = new Process { StartInfo = start };
            if (!process.Start()) throw new InvalidOperationException("تعذر تشغيل أداة النسخ الاحتياطي المحلية لـ PostgreSQL.");
            var stderrTask = process.StandardError.ReadToEndAsync(ct);
            await using (var output = new FileStream(filePath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 128 * 1024, useAsync: true))
            {
                // Set ownership only after CreateNew succeeds. A same-second filename collision
                // must never cause the catch block to delete a backup created by an earlier request.
                archiveCreatedByThisRequest = true;
                await process.StandardOutput.BaseStream.CopyToAsync(output, ct);
            }
            await process.WaitForExitAsync(ct);
            var stderr = await stderrTask;
            if (process.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrWhiteSpace(stderr) ? $"فشل pg_dump برمز {process.ExitCode}." : stderr.Trim());
            var info = new FileInfo(filePath);
            if (info.Length < 128) throw new InvalidOperationException("أنشأ pg_dump ملفًا أصغر من المتوقع؛ لم تُعتمد النسخة الاحتياطية.");

            // Only the all-scope archive is a complete database backup accepted by Test 8/10.
            // Scoped data-only archives deliberately receive no full-restore manifest.
            if (allScope)
            {
                await WriteFullBackupManifestAsync(filePath, databaseName, pgRestorePath, ct);
                manifestCreatedByThisRequest = true;
            }

            var completed = DateTimeOffset.UtcNow;
            await using var update = dataSource.CreateCommand("UPDATE system_backups SET status='completed',file_size_bytes=@size,completed_at=@at,error_message=NULL WHERE id=@id;");
            update.Parameters.AddWithValue("size", info.Length); update.Parameters.AddWithValue("at", completed); update.Parameters.AddWithValue("id", id);
            await update.ExecuteNonQueryAsync(ct);
            return new BackupCreatedResult(id, fileName, scopeLabel, info.Length, completed);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Backup {BackupId} failed", id);
            // Delete only artifacts this request actually created. In particular, a FileMode.CreateNew
            // collision must never delete a previous successful backup or its manifest.
            try { if (manifestCreatedByThisRequest && File.Exists(filePath + ".json")) File.Delete(filePath + ".json"); } catch { /* best effort cleanup */ }
            try { if (archiveCreatedByThisRequest && File.Exists(filePath)) File.Delete(filePath); } catch { /* best effort cleanup */ }
            await using var fail = dataSource.CreateCommand("UPDATE system_backups SET status='failed',completed_at=now(),error_message=@error WHERE id=@id;");
            fail.Parameters.AddWithValue("error", ex.Message.Length > 1500 ? ex.Message[..1500] : ex.Message); fail.Parameters.AddWithValue("id", id);
            await fail.ExecuteNonQueryAsync(CancellationToken.None);
            throw;
        }
    }

    public async Task PurgeExpiredTrashAsync(CancellationToken ct)
    {
        await using var command = dataSource.CreateCommand("SELECT id,entity_type,entity_id FROM trash_items WHERE restored_at IS NULL AND purged_at IS NULL AND expires_at<=now() ORDER BY CASE entity_type WHEN 'student-note' THEN 1 WHEN 'payment' THEN 2 WHEN 'student-attendance' THEN 3 WHEN 'teacher-attendance' THEN 4 WHEN 'schedule-slot' THEN 5 WHEN 'advertising-expense' THEN 6 WHEN 'operating-expense' THEN 6 WHEN 'monthly-charge' THEN 7 WHEN 'enrollment' THEN 8 WHEN 'student' THEN 9 WHEN 'teacher' THEN 10 WHEN 'circle' THEN 11 ELSE 12 END, deleted_at;");
        var expired = new List<(Guid TrashId, string EntityType, Guid EntityId)>();
        await using (var reader = await command.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) expired.Add((reader.GetGuid(0), reader.GetString(1), reader.GetGuid(2)));

        foreach (var item in expired)
        {
            ct.ThrowIfCancellationRequested();
            if (FinancialTrashTypes.Contains(item.EntityType))
            {
                logger.LogWarning("Financial trash item {TrashId} ({EntityType}) is retained and will not be purged", item.TrashId, item.EntityType);
                continue;
            }
            if (!TrashTables.TryGetValue(item.EntityType, out var table)) continue;
            await using var connection = await dataSource.OpenConnectionAsync(ct);
            await using var tx = await connection.BeginTransactionAsync(ct);
            try
            {
                await using (var delete = new NpgsqlCommand($"DELETE FROM public.{table} WHERE id=@id AND is_trashed=TRUE;", connection, tx))
                { delete.Parameters.AddWithValue("id", item.EntityId); await delete.ExecuteNonQueryAsync(ct); }
                await using (var mark = new NpgsqlCommand("UPDATE trash_items SET purged_at=now(),purge_error=NULL WHERE id=@id AND restored_at IS NULL;", connection, tx))
                { mark.Parameters.AddWithValue("id", item.TrashId); await mark.ExecuteNonQueryAsync(ct); }
                await tx.CommitAsync(ct);
            }
            catch (PostgresException ex) when (ex.SqlState == "23503")
            {
                await tx.RollbackAsync(ct);
                await using var blocked = dataSource.CreateCommand("UPDATE trash_items SET purge_error=@error WHERE id=@id;");
                blocked.Parameters.AddWithValue("error", "تأخر الحذف النهائي لوجود سجلات مرتبطة؛ راجع العلاقات قبل الحذف. " + ex.ConstraintName);
                blocked.Parameters.AddWithValue("id", item.TrashId); await blocked.ExecuteNonQueryAsync(ct);
                logger.LogWarning("Trash item {TrashId} cannot be purged because a dependent record still exists", item.TrashId);
            }
        }
    }

    public static string[] TablesForEntityExport(string entityType) => entityType switch
    {
        // Student export includes the full student record and its enrolments, charges, payments and attendance.
        "student" => ["students", "student_notes", "circle_enrollments", "monthly_charges", "payments", "student_attendance", "circles", "teachers", "circle_schedule_slots"],
        // Teacher export deliberately excludes student fee/payment tables: it contains assignment and attendance records only.
        "teacher" => ["teachers", "teacher_notes", "circles", "circle_schedule_slots", "circle_enrollments", "students", "teacher_attendance", "student_attendance"],
        // Circle export includes the circle, roster, attendance and the circle's operational/finance records.
        "circle" => ["circles", "circle_schedule_slots", "circle_enrollments", "students", "teachers", "student_notes", "student_attendance", "teacher_attendance", "monthly_charges", "payments", "advertising_expenses", "operating_expenses"],
        _ => throw new ArgumentException("نوع التصدير التفصيلي غير مدعوم.")
    };

    public static string[] TablesForExport(IEnumerable<string> requestedScopes)
    {
        var scopes = requestedScopes.Select(x => x.Trim().ToLowerInvariant()).Where(x => x.Length > 0).Distinct().ToArray();
        if (scopes.Length == 0 || scopes.Contains("all", StringComparer.OrdinalIgnoreCase))
            return BackupTables.Values.SelectMany(x => x).Append("students").Append("teachers").Append("circles").Append("operating_expenses").Append("advertising_expenses").Append("teacher_attendance").Append("collection_reports").Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (scopes.Any(x => !BackupTables.ContainsKey(x))) throw new ArgumentException("اختر قسمًا صحيحًا للتصدير.");
        return scopes.SelectMany(s => BackupTables[s]).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }
}
