using Npgsql;

namespace DarEltahfeez.Api.Media;

/// <summary>
/// Deliberate batch backfill of legacy BYTEA rows (admin endpoint, status counts and the
/// Media__BackfillOnStartup flag). Split from the lazy/repair read path to keep each file small;
/// both parts of the partial class share the same store code.
/// </summary>
public sealed partial class MediaBackfillService
{
    private async Task<MediaBackfillCounters> BackfillPaymentsAsync(CancellationToken cancellationToken)
    {
        var counters = new MutableCounters();
        while (!cancellationToken.IsCancellationRequested)
        {
            var batch = await LoadBatchAsync(
                """
                SELECT id,receipt_data,receipt_content_type FROM payments
                WHERE receipt_data IS NOT NULL AND receipt_file_path IS NULL
                ORDER BY id
                LIMIT @limit;
                """, cancellationToken);
            if (batch.Count == 0) break;
            foreach (var row in batch)
            {
                if (cancellationToken.IsCancellationRequested) break;
                counters.Attempted++;
                try
                {
                    var stored = await StoreReceiptAsync(row.Id, row.Data, row.ContentType, allowOverwritePath: false, cancellationToken);
                    if (stored is not null) counters.Migrated++;
                    else counters.Skipped++;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    counters.Failed++;
                    _logger.LogError(ex, "Media backfill failed for payment receipt {PaymentId}; the legacy BYTEA is untouched.", row.Id);
                }
            }

            if (counters.Migrated + counters.Skipped == 0) break; // never spin forever on a broken batch
        }

        return counters.ToRecord();
    }

    private async Task<MediaBackfillCounters> BackfillAvatarsAsync(CancellationToken cancellationToken)
    {
        var counters = new MutableCounters();
        while (!cancellationToken.IsCancellationRequested)
        {
            var batch = await LoadBatchAsync(
                """
                SELECT id,avatar_data,avatar_content_type FROM app_users
                WHERE avatar_data IS NOT NULL AND avatar_file_path IS NULL
                ORDER BY id
                LIMIT @limit;
                """, cancellationToken);
            if (batch.Count == 0) break;
            foreach (var row in batch)
            {
                if (cancellationToken.IsCancellationRequested) break;
                counters.Attempted++;
                try
                {
                    var stored = await StoreAvatarAsync(row.Id, row.Data, row.ContentType, allowOverwritePath: false, cancellationToken);
                    if (stored is not null) counters.Migrated++;
                    else counters.Skipped++;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    counters.Failed++;
                    _logger.LogError(ex, "Media backfill failed for avatar of user {UserId}; the legacy BYTEA is untouched.", row.Id);
                }
            }

            if (counters.Migrated + counters.Skipped == 0) break;
        }

        return counters.ToRecord();
    }

    private async Task<MediaBackfillCounters> BackfillLogoAsync(CancellationToken cancellationToken)
    {
        var counters = new MutableCounters();
        byte[]? data;
        string? declaredContentType;
        await using (var connection = await _dataSource.OpenConnectionAsync(cancellationToken))
        await using (var read = new NpgsqlCommand(
                         "SELECT logo_data,logo_content_type FROM school_settings WHERE id=1 AND logo_data IS NOT NULL AND logo_file_path IS NULL;",
                         connection))
        {
            await using var reader = await read.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken)) return counters.ToRecord();
            data = reader.GetFieldValue<byte[]>(0);
            declaredContentType = reader.IsDBNull(1) ? null : reader.GetString(1);
        }

        counters.Attempted++;
        try
        {
            var stored = data is { Length: > 0 }
                ? await StoreLogoAsync(data, declaredContentType, allowOverwritePath: false, cancellationToken)
                : null;
            if (stored is not null) counters.Migrated++;
            else counters.Skipped++;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            counters.Failed++;
            _logger.LogError(ex, "Media backfill failed for the branding logo; the legacy BYTEA is untouched.");
        }

        return counters.ToRecord();
    }

    private async Task<List<LegacyBlobRow>> LoadBatchAsync(string sql, CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue("limit", Math.Clamp(_options.BackfillBatchSize, 1, 100));
        var rows = new List<LegacyBlobRow>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new LegacyBlobRow(
                reader.GetGuid(0),
                reader.GetFieldValue<byte[]>(1),
                reader.IsDBNull(2) ? null : reader.GetString(2)));
        }

        return rows;
    }

    private sealed record LegacyBlobRow(Guid Id, byte[] Data, string? ContentType);
}
