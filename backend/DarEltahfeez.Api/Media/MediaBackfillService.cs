using System.Diagnostics;
using Npgsql;

namespace DarEltahfeez.Api.Media;

/// <summary>Per-family counters of a deliberate BYTEA-to-file backfill run.</summary>
public sealed record MediaBackfillCounters(int Attempted, int Migrated, int Skipped, int Failed);

/// <summary>Result returned by the admin backfill endpoint and written to the startup log.</summary>
public sealed record MediaBackfillResult(
    bool DryRun,
    MediaBackfillCounters Receipts,
    MediaBackfillCounters Avatars,
    MediaBackfillCounters Logos,
    long ElapsedMilliseconds);

/// <summary>How many legacy BYTEA rows still have no file-backed column.</summary>
public sealed record MediaPendingCounts(int Receipts, int Avatars, int Logos);

/// <summary>
/// Tier 2.5 BYTEA-to-file migration.
///
/// Two callers share exactly the same store code:
///   * lazy migration on the first read of a legacy row (receipt download, avatar GET, branding
///     GET): Migrate* methods; plus Repair* methods when the recorded file disappeared but the
///     legacy BYTEA still exists (dual-read fallback);
///   * the deliberate batch entry points (admin backfill endpoint, Media__BackfillOnStartup):
///     <see cref="RunAsync"/> in the Batch partial file.
///
/// Every migration is idempotent and content-addressed: writing the same bytes twice reuses the
/// same SHA-256 file, and the UPDATE ... WHERE path IS NULL never overwrites a concurrent write.
/// The legacy BYTEA column is never modified or cleared here.
/// </summary>
public sealed partial class MediaBackfillService
{
    private const string ReceiptContentTypeFallback = MediaContentTypes.OctetStream;
    private const string BrandingContentTypeFallback = MediaContentTypes.Png;

    private readonly NpgsqlDataSource _dataSource;
    private readonly IMediaFileStore _store;
    private readonly MediaOptions _options;
    private readonly ILogger<MediaBackfillService> _logger;

    public MediaBackfillService(
        NpgsqlDataSource dataSource,
        IMediaFileStore store,
        MediaOptions options,
        ILogger<MediaBackfillService> logger)
    {
        _dataSource = dataSource;
        _store = store;
        _options = options;
        _logger = logger;
    }

    public async Task<MediaPendingCounts> CountPendingAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
        var receipts = await CountAsync(connection,
            "SELECT count(*) FROM payments WHERE receipt_data IS NOT NULL AND receipt_file_path IS NULL;", cancellationToken);
        var avatars = await CountAsync(connection,
            "SELECT count(*) FROM app_users WHERE avatar_data IS NOT NULL AND avatar_file_path IS NULL;", cancellationToken);
        var logos = await CountAsync(connection,
            "SELECT count(*) FROM school_settings WHERE logo_data IS NOT NULL AND logo_file_path IS NULL;", cancellationToken);
        return new MediaPendingCounts(receipts, avatars, logos);
    }

    public async Task<MediaBackfillResult> RunAsync(bool dryRun, CancellationToken cancellationToken = default)
    {
        var stopwatch = Stopwatch.StartNew();
        if (dryRun)
        {
            var pending = await CountPendingAsync(cancellationToken);
            _logger.LogInformation(
                "Media backfill dry run: pending receipts={Receipts} avatars={Avatars} logos={Logos} root={Root}",
                pending.Receipts, pending.Avatars, pending.Logos, _store.RootPath);
            return new MediaBackfillResult(
                true,
                new MediaBackfillCounters(pending.Receipts, 0, 0, 0),
                new MediaBackfillCounters(pending.Avatars, 0, 0, 0),
                new MediaBackfillCounters(pending.Logos, 0, 0, 0),
                stopwatch.ElapsedMilliseconds);
        }

        var receipts = await BackfillPaymentsAsync(cancellationToken);
        var avatars = await BackfillAvatarsAsync(cancellationToken);
        var logos = await BackfillLogoAsync(cancellationToken);
        stopwatch.Stop();
        _logger.LogInformation(
            "Media backfill finished in {ElapsedMs}ms: receipts={Receipts} avatars={Avatars} logos={Logos} root={Root}",
            stopwatch.ElapsedMilliseconds, receipts, avatars, logos, _store.RootPath);
        return new MediaBackfillResult(false, receipts, avatars, logos, stopwatch.ElapsedMilliseconds);
    }

    // ---------------------------------------------------------------------------------------
    // Lazy migration + repair (single row, triggered by a legacy read path)
    // ---------------------------------------------------------------------------------------

    public Task<MediaBlob?> MigrateReceiptAsync(Guid paymentId, CancellationToken cancellationToken = default) =>
        MigrateReceiptCoreAsync(paymentId, allowOverwritePath: false, cancellationToken);

    /// <summary>Re-materialise a receipt file whose DB path is set but whose file vanished.</summary>
    public Task<MediaBlob?> RepairReceiptFileAsync(Guid paymentId, CancellationToken cancellationToken = default) =>
        MigrateReceiptCoreAsync(paymentId, allowOverwritePath: true, cancellationToken);

    private async Task<MediaBlob?> MigrateReceiptCoreAsync(Guid paymentId, bool allowOverwritePath, CancellationToken cancellationToken)
    {
        var legacy = await ReadLegacyBlobAsync(
            "SELECT receipt_data,receipt_content_type FROM payments WHERE id=@id AND receipt_data IS NOT NULL;",
            "id", paymentId, cancellationToken);
        return legacy is null ? null : await StoreReceiptAsync(paymentId, legacy.Data, legacy.ContentType, allowOverwritePath, cancellationToken);
    }

    public Task<MediaBlob?> MigrateAvatarAsync(Guid userId, CancellationToken cancellationToken = default) =>
        MigrateAvatarCoreAsync(userId, allowOverwritePath: false, cancellationToken);

    /// <summary>Re-materialise an avatar file whose DB path is set but whose file vanished.</summary>
    public Task<MediaBlob?> RepairAvatarFileAsync(Guid userId, CancellationToken cancellationToken = default) =>
        MigrateAvatarCoreAsync(userId, allowOverwritePath: true, cancellationToken);

    private async Task<MediaBlob?> MigrateAvatarCoreAsync(Guid userId, bool allowOverwritePath, CancellationToken cancellationToken)
    {
        var legacy = await ReadLegacyBlobAsync(
            "SELECT avatar_data,avatar_content_type FROM app_users WHERE id=@id AND avatar_data IS NOT NULL;",
            "id", userId, cancellationToken);
        return legacy is null ? null : await StoreAvatarAsync(userId, legacy.Data, legacy.ContentType, allowOverwritePath, cancellationToken);
    }

    public Task<MediaBlob?> MigrateLogoAsync(CancellationToken cancellationToken = default) =>
        MigrateLogoCoreAsync(allowOverwritePath: false, cancellationToken);

    /// <summary>Re-materialise the branding logo file when its DB path is set but the file vanished.</summary>
    public Task<MediaBlob?> RepairLogoFileAsync(CancellationToken cancellationToken = default) =>
        MigrateLogoCoreAsync(allowOverwritePath: true, cancellationToken);

    private async Task<MediaBlob?> MigrateLogoCoreAsync(bool allowOverwritePath, CancellationToken cancellationToken)
    {
        var legacy = await ReadLegacyBlobAsync(
            "SELECT logo_data,logo_content_type FROM school_settings WHERE id=1 AND logo_data IS NOT NULL;",
            null, null, cancellationToken);
        return legacy is null ? null : await StoreLogoAsync(legacy.Data, legacy.ContentType, allowOverwritePath, cancellationToken);
    }

    // ---------------------------------------------------------------------------------------
    // Store + persistence helpers
    // ---------------------------------------------------------------------------------------

    private async Task<MediaBlob?> StoreReceiptAsync(
        Guid paymentId, byte[] data, string? declaredContentType, bool allowOverwritePath, CancellationToken cancellationToken)
    {
        var contentType = MediaContentTypes.ResolveLegacy(declaredContentType, data, ReceiptContentTypeFallback);
        var stored = await _store.SaveReceiptAsync(data, contentType, cancellationToken);
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
        var guard = allowOverwritePath ? string.Empty : " AND receipt_file_path IS NULL";
        await using var update = new NpgsqlCommand(
            $"""
             UPDATE payments
             SET receipt_file_path=@path, receipt_size_bytes=@size,
                 receipt_content_type=COALESCE(receipt_content_type,@type)
             WHERE id=@id{guard};
             """, connection);
        update.Parameters.AddWithValue("path", stored.RelativePath);
        update.Parameters.AddWithValue("size", stored.SizeBytes);
        update.Parameters.AddWithValue("type", stored.ContentType);
        update.Parameters.AddWithValue("id", paymentId);
        var affected = await update.ExecuteNonQueryAsync(cancellationToken);
        return affected == 0 ? null : new MediaBlob(data, stored.ContentType);
    }

    private async Task<MediaBlob?> StoreAvatarAsync(
        Guid userId, byte[] data, string? declaredContentType, bool allowOverwritePath, CancellationToken cancellationToken)
    {
        var contentType = ResolveBrandingContentType(declaredContentType);
        var stored = await _store.SaveAvatarAsync(data, contentType, cancellationToken);
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
        var guard = allowOverwritePath ? string.Empty : " AND avatar_file_path IS NULL";
        await using var update = new NpgsqlCommand(
            $"""
             UPDATE app_users
             SET avatar_file_path=@path, avatar_size_bytes=@size,
                 avatar_content_type=COALESCE(avatar_content_type,@type)
             WHERE id=@id{guard};
             """, connection);
        update.Parameters.AddWithValue("path", stored.RelativePath);
        update.Parameters.AddWithValue("size", stored.SizeBytes);
        update.Parameters.AddWithValue("type", stored.ContentType);
        update.Parameters.AddWithValue("id", userId);
        var affected = await update.ExecuteNonQueryAsync(cancellationToken);
        return affected == 0 ? null : new MediaBlob(data, stored.ContentType);
    }

    private async Task<MediaBlob?> StoreLogoAsync(byte[] data, string? declaredContentType, bool allowOverwritePath, CancellationToken cancellationToken)
    {
        var contentType = ResolveBrandingContentType(declaredContentType);
        var stored = await _store.SaveLogoAsync(data, contentType, cancellationToken);
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
        var guard = allowOverwritePath ? string.Empty : " AND logo_file_path IS NULL";
        await using var update = new NpgsqlCommand(
            $"""
             UPDATE school_settings
             SET logo_file_path=@path, logo_size_bytes=@size,
                 logo_content_type=COALESCE(logo_content_type,@type)
             WHERE id=1{guard};
             """, connection);
        update.Parameters.AddWithValue("path", stored.RelativePath);
        update.Parameters.AddWithValue("size", stored.SizeBytes);
        update.Parameters.AddWithValue("type", stored.ContentType);
        var affected = await update.ExecuteNonQueryAsync(cancellationToken);
        return affected == 0 ? null : new MediaBlob(data, stored.ContentType);
    }

    /// <summary>Branding/avatar keep their historical "image/png" fallback for a NULL content type.</summary>
    private static string ResolveBrandingContentType(string? declaredContentType) =>
        MediaContentTypes.IsSupported(declaredContentType)
            ? MediaContentTypes.Normalize(declaredContentType)
            : BrandingContentTypeFallback;

    private async Task<LegacyBlob?> ReadLegacyBlobAsync(
        string sql, string? idParameterName, Guid? id, CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
        await using var read = new NpgsqlCommand(sql, connection);
        if (idParameterName is not null) read.Parameters.AddWithValue(idParameterName, id!.Value);
        await using var reader = await read.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        var data = reader.GetFieldValue<byte[]>(0);
        var contentType = reader.IsDBNull(1) ? null : reader.GetString(1);
        return data.Length == 0 ? null : new LegacyBlob(data, contentType);
    }

    private static async Task<int> CountAsync(NpgsqlConnection connection, string sql, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken) ?? 0, System.Globalization.CultureInfo.InvariantCulture);
    }

    private sealed record LegacyBlob(byte[] Data, string? ContentType);

    private sealed class MutableCounters
    {
        public int Attempted;
        public int Migrated;
        public int Skipped;
        public int Failed;
        public MediaBackfillCounters ToRecord() => new(Attempted, Migrated, Skipped, Failed);
    }
}
