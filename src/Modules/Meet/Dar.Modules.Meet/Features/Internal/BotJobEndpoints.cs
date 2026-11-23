using System.Security.Cryptography;
using System.Text;
using Dar.Modules.Meet.Domain;
using Dar.Modules.Meet.Infrastructure;
using Dar.Modules.Meet.Persistence;
using Microsoft.Extensions.Options;

namespace Dar.Modules.Meet.Features.Internal;

public sealed record BotArtifactRequest(
    string? Kind,
    string? LocalPath,
    long SizeBytes,
    string? Sha256,
    int DurationSeconds,
    short PartNo = 1);

public sealed record BotStatusRequest(
    string? Status,
    string? ErrorCode,
    string? ErrorMessage,
    int DurationSeconds = 0,
    IReadOnlyList<BotArtifactRequest>? Artifacts = null);

/// <summary>
/// Loopback-only control plane used by dar-meet-bot. Every call must carry
/// <c>X-Dar-Service-Token</c>; Nginx only proxies /api/v1 and /, so these routes are
/// unreachable from the internet even before the token check.
/// </summary>
public static class BotJobEndpoints
{
    private const string TokenHeader = "X-Dar-Service-Token";
    private const string WorkerHeader = "X-Dar-Worker";

    public static RouteGroupBuilder MapMeetBotJobs(this RouteGroupBuilder group)
    {
        group.MapGet("/health", HealthAsync).WithName("MeetBotHealth");
        group.MapPost("/jobs/claim", ClaimAsync).WithName("MeetBotClaim");
        group.MapPost("/jobs/{id:guid}/heartbeat", HeartbeatAsync).WithName("MeetBotHeartbeat");
        group.MapPost("/jobs/{id:guid}/status", SetStatusAsync).WithName("MeetBotStatus");
        return group;
    }

    private static async Task<IResult> HealthAsync(
        HttpContext context,
        IOptions<MeetOptions> options,
        MeetBotJobRepository repository,
        CancellationToken ct)
    {
        if (Deny(context, options) is { } denied) return denied;

        var stale = options.Value.BotHealthStaleSeconds;
        var snapshot = await repository.SnapshotAsync(stale, ct);
        return Results.Ok(new
        {
            status = "ok",
            service = "dar-meet-bot",
            pending = snapshot.Pending,
            active = snapshot.Active,
            stale = snapshot.Stale,
            staleAfterSeconds = stale
        });
    }

    private static async Task<IResult> ClaimAsync(
        HttpContext context,
        IOptions<MeetOptions> options,
        MeetBotJobRepository repository,
        CancellationToken ct)
    {
        if (Deny(context, options) is { } denied) return denied;

        var worker = context.Request.Headers[WorkerHeader].ToString();
        if (string.IsNullOrWhiteSpace(worker)) worker = "dar-meet-bot";
        var job = await repository.ClaimNextAsync(worker, ct);
        return job is null
            ? Results.NoContent()
            : Results.Ok(new
            {
                id = job.Id,
                eventId = job.EventId,
                occurrenceKey = job.OccurrenceKey,
                status = job.Status,
                scheduledStart = job.ScheduledStart,
                scheduledEnd = job.ScheduledEnd,
                joinAt = job.JoinAt,
                stopGraceSeconds = job.StopGraceSeconds,
                joinLeadSeconds = job.JoinLeadSeconds,
                circleId = job.CircleId,
                summary = job.Summary,
                meetLink = job.MeetLink
            });
    }

    private static async Task<IResult> HeartbeatAsync(
        Guid id,
        HttpContext context,
        IOptions<MeetOptions> options,
        MeetBotJobRepository repository,
        CancellationToken ct)
    {
        if (Deny(context, options) is { } denied) return denied;

        if (!await repository.HeartbeatAsync(id, ct))
            return Results.Json(new { message = "المهمة غير موجودة أو ليست نشطة." }, statusCode: 404);
        return Results.NoContent();
    }

    private static async Task<IResult> SetStatusAsync(
        Guid id,
        BotStatusRequest request,
        HttpContext context,
        IOptions<MeetOptions> options,
        MeetBotJobRepository repository,
        CancellationToken ct)
    {
        if (Deny(context, options) is { } denied) return denied;

        var status = request.Status?.Trim().ToLowerInvariant();
        if (status is null || !MeetJobStates.IsKnown(status))
            return Results.Json(new { message = "حالة غير معروفة." }, statusCode: 422);

        var rejection = await repository.SetStatusAsync(id, status, request.ErrorCode, request.ErrorMessage, ct);
        if (rejection is not null)
        {
            return rejection == "job_not_found"
                ? Results.Json(new { message = "المهمة غير موجودة." }, statusCode: 404)
                : Results.Json(new { message = "انتقال حالة غير مسموح.", detail = rejection }, statusCode: 409);
        }

        if (status == MeetJobStates.Live)
        {
            var sessionId = await repository.EnsureSessionAsync(id, ct);
            return Results.Ok(new { sessionId });
        }

        if (status is MeetJobStates.Ready or MeetJobStates.Failed or MeetJobStates.Partial)
        {
            var artifacts = (request.Artifacts ?? [])
                .Where(item => !string.IsNullOrWhiteSpace(item.Kind) && !string.IsNullOrWhiteSpace(item.LocalPath))
                .Select(item => new BotArtifact(
                    item.Kind!.Trim().ToLowerInvariant(),
                    item.LocalPath!,
                    item.SizeBytes,
                    item.Sha256,
                    item.DurationSeconds,
                    item.PartNo))
                .ToArray();
            var sessionStatus = status == MeetJobStates.Ready ? "ready"
                : status == MeetJobStates.Partial ? "partial"
                : "failed";
            await repository.FinishSessionAsync(id, sessionStatus, request.DurationSeconds, artifacts, ct);
            return Results.Ok(new { artifacts = artifacts.Length });
        }

        return Results.NoContent();
    }

    private static IResult? Deny(HttpContext context, IOptions<MeetOptions> options)
    {
        var expected = options.Value.InternalToken;
        if (string.IsNullOrWhiteSpace(expected))
            return Results.Json(new { message = "Meet internal API is not configured." }, statusCode: 503);

        var provided = context.Request.Headers[TokenHeader].ToString();
        return Matches(expected, provided)
            ? null
            : Results.Json(new { message = "Invalid service token." }, statusCode: 401);
    }

    private static bool Matches(string expected, string provided)
    {
        var left = SHA256.HashData(Encoding.UTF8.GetBytes(expected));
        var right = SHA256.HashData(Encoding.UTF8.GetBytes(provided));
        return CryptographicOperations.FixedTimeEquals(left, right);
    }
}
