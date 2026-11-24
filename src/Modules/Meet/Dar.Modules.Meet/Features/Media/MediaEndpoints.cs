using System.Security.Claims;
using Dar.Common.Domain;
using Dar.Modules.Meet.Application;
using Dar.Modules.Meet.Infrastructure;
using Dar.Modules.Meet.Persistence;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Dar.Modules.Meet.Features.Media;

public sealed record MeetSessionDto(
    Guid Id,
    string? Summary,
    string? CircleName,
    DateTimeOffset StartedAt,
    int? DurationSeconds,
    string Status,
    long? SizeBytes,
    bool UploadedToDrive,
    string? StreamUrl,
    string? PosterUrl);

/// <summary>
/// Lists finished recordings and streams their files to the authenticated admin.
/// Files are resolved through the database and must live under Meet:MediaRoot, so a
/// crafted asset id can never reach another path on the host.
/// </summary>
public static class MediaEndpoints
{
    public static RouteGroupBuilder MapMeetMedia(this RouteGroupBuilder group)
    {
        group.MapGet("/sessions", ListAsync).RequireAuthorization(MeetPermissions.MediaView).WithName("MeetSessions");
        group.MapGet("/media/{id:guid}", StreamAsync)
            .RequireAuthorization(MeetPermissions.MediaView)
            .WithName("MeetMediaStream");
        return group;
    }

    private static async Task<IResult> ListAsync(
        int? limit,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        MeetMediaRepository repository,
        CancellationToken ct)
    {
        // Recordings follow the same circle scope as the rest of the Meet module: an admin
        // (users.manage) or a user with no scope rows sees everything, a restricted
        // supervisor only sees recordings linked to their allowed circles. Manual
        // recordings without a circle stay admin-only.
        var scope = await MeetAccessScope.LoadAsync(dataSource, principal, ct);
        var rows = await repository.ListSessionsAsync(limit ?? 50, scope, ct);
        return Results.Ok(new
        {
            count = rows.Count,
            sessions = rows.Select(row => new MeetSessionDto(
                row.Id,
                row.Summary,
                row.CircleName,
                row.StartedAt,
                row.DurationSeconds,
                row.Status,
                row.Mp4SizeBytes,
                row.UploadedToDrive,
                row.Mp4AssetId is { } mp4 ? $"/api/v1/meet/media/{mp4}" : null,
                row.PosterAssetId is { } poster ? $"/api/v1/meet/media/{poster}" : null))
        });
    }

    private static async Task<IResult> StreamAsync(
        Guid id,
        bool? download,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        MeetMediaRepository repository,
        IOptions<MeetOptions> options,
        CancellationToken ct)
    {
        var scope = await MeetAccessScope.LoadAsync(dataSource, principal, ct);
        // The asset lookup joins the session and applies the circle scope, so an out-of-scope
        // asset id cannot be streamed or downloaded even when the caller knows it.
        var asset = await repository.GetAssetAsync(id, scope, ct)
                    ?? throw AppException.NotFound("الملف غير موجود أو تم حذفه.");

        var root = Path.GetFullPath(options.Value.MediaRoot);
        var full = Path.GetFullPath(asset.LocalPath);
        if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw AppException.Forbidden("مسار الملف خارج مجلد الوسائط.");

        if (!File.Exists(full))
            throw AppException.NotFound("الملف غير موجود على القرص.");

        var contentType = asset.Kind switch
        {
            "poster" => "image/jpeg",
            "mp4" => "video/mp4",
            _ => "application/octet-stream"
        };
        var name = $"{asset.Kind}-{asset.SessionId:N}.{(asset.Kind == "poster" ? "jpg" : "mp4")}";
        return Results.File(full, contentType, download == true ? name : null, enableRangeProcessing: true);
    }
}
