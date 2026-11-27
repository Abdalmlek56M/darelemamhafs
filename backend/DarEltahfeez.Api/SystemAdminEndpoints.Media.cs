using System.Globalization;
using DarEltahfeez.Api.Media;
using Npgsql;

namespace DarEltahfeez.Api;

/// <summary>
/// Tier 2.5 operational endpoints for the file-backed media migration. Both require
/// settings.manage (admins, who already have full scope) and are safe to call repeatedly.
///   GET  /api/admin/media/status   resolved media root + pending/file-backed row counts
///   POST /api/admin/media/backfill deliberately migrate legacy BYTEA rows (?dryRun=true to plan)
/// </summary>
public static partial class SystemAdminEndpoints
{
    private static void MapMediaMaintenance(WebApplication app)
    {
        var media = app.MapGroup("/api/admin/media").RequireAuthorization("settings.manage");

        media.MapGet("/status", async Task<IResult> (IMediaFileStore fileStore, MediaBackfillService backfill, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var pending = await backfill.CountPendingAsync(ct);
            var fileBacked = new
            {
                receipts = await ScalarIntAsync(db, "SELECT count(*) FROM payments WHERE receipt_file_path IS NOT NULL;", ct),
                avatars = await ScalarIntAsync(db, "SELECT count(*) FROM app_users WHERE avatar_file_path IS NOT NULL;", ct),
                logos = await ScalarIntAsync(db, "SELECT count(*) FROM school_settings WHERE logo_file_path IS NOT NULL;", ct),
            };
            return Results.Ok(new
            {
                rootPath = fileStore.RootPath,
                fileBacked,
                pending = new { receipts = pending.Receipts, avatars = pending.Avatars, logos = pending.Logos },
            });
        });

        media.MapPost("/backfill", async Task<IResult> (bool? dryRun, MediaBackfillService backfill, CancellationToken ct) =>
            Results.Ok(await backfill.RunAsync(dryRun == true, ct)));
    }

    private static async Task<int> ScalarIntAsync(NpgsqlDataSource db, string sql, CancellationToken ct)
    {
        await using var cmd = db.CreateCommand(sql);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct) ?? 0, CultureInfo.InvariantCulture);
    }
}
