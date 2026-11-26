using DarEltahfeez.Api.Services;

namespace DarEltahfeez.Api;

/// <summary>
/// FINAL 1.1: a manual trigger for the same purge routine the scheduled worker runs.
/// Useful for operations and for the regression suite; trash.manage is required.
/// </summary>
public static partial class SystemAdminEndpoints
{
    internal static void MapTrashPurge(WebApplication app)
    {
        app.MapPost("/api/admin/trash/purge-expired", async Task<IResult> (SystemAdminService service, CancellationToken ct) =>
        {
            await service.PurgeExpiredTrashAsync(ct);
            return Results.Ok(new { ok = true });
        }).RequireAuthorization("trash.manage");
    }
}
