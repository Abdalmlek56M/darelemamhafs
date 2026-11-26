using Npgsql;

namespace Dar.Api.Features.System.NotificationSync;

/// <summary>FINAL 1.13: the scheduled unpaid-notification sync is also triggerable for
/// operations/tests; it must refresh bodies without reopening resolved notifications.</summary>
public static class NotificationSyncEndpoints
{
    public static IEndpointRouteBuilder MapNotificationSyncEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/system/notifications/sync", async (NpgsqlDataSource db, CancellationToken ct) =>
        {
            var refreshed = await NotificationSyncService.SyncAsync(db, ct);
            return Results.Ok(new { refreshed });
        }).RequireAuthorization("users.manage");
        return app;
    }
}
