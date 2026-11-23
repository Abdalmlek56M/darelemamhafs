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
        MeetMediaRepository repository,
        CancellationToken ct)
    {
        var rows = await repository.ListSessionsAsync(limit ?? 50, ct);
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
        MeetMediaRepository repository,
        IOptions<MeetOptions> options,
        CancellationToken ct)
    {
        var asset = await repository.GetAssetAsync(id, ct)
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
