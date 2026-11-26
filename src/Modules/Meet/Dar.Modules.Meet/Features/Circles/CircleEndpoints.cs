using System.Security.Claims;
using Dar.Common.Domain;
using Dar.Modules.Meet.Application;
using Dar.Modules.Meet.Persistence;
using Npgsql;

namespace Dar.Modules.Meet.Features.Circles;

/// <summary>Which circles are eligible for automatic recording (the owner's selected scope).</summary>
public static class CircleEndpoints
{
    public static RouteGroupBuilder MapMeetCircles(this RouteGroupBuilder group)
    {
        group.MapGet("/circles", ListAsync).RequireAuthorization(MeetPermissions.View).WithName("MeetCircles");
        group.MapPut("/circles/{id:guid}", UpdateAsync)
            .RequireAuthorization(MeetPermissions.Manage)
            .WithName("MeetCircleSettings");
        group.MapGet("/settings", SettingsAsync).RequireAuthorization(MeetPermissions.View).WithName("MeetSettings");
        return group;
    }

    private static async Task<IResult> ListAsync(
        MeetScopeRepository repository,
        NpgsqlDataSource dataSource,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var scope = await MeetAccessScope.LoadAsync(dataSource, principal, ct);
        var rows = await repository.ListCircleSettingsAsync(scope.All ? null : scope.CircleIds, ct);
        return Results.Ok(new
        {
            scoped = !scope.All,
            circles = rows.Select(row => new MeetCircleSettingDto(
                row.CircleId, row.Name, row.IsActive, row.AutoRecord, row.AutoLink, row.UpcomingLinkedEvents))
        });
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        MeetCircleSettingRequest request,
        MeetScopeRepository repository,
        NpgsqlDataSource dataSource,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        var scope = await MeetAccessScope.LoadAsync(dataSource, principal, ct);
        if (!scope.All && !scope.AllowsCircle(id))
            throw AppException.Forbidden("الحلقة خارج نطاق صلاحيتك.");
        if (!await repository.CircleExistsAsync(id, ct))
            throw AppException.NotFound("الحلقة غير موجودة أو تمت أرشفتها.");

        await repository.SaveCircleSettingsAsync(
            id, request.AutoRecord, request.AutoLink, MeetPrincipal.UserId(principal), ct);

        await MeetAudit.WriteAsync(
            dataSource, principal, "meet.circle.settings", "circle", id,
            new { autoRecord = request.AutoRecord, autoLink = request.AutoLink },
            http.Request.Path.ToString(), http.Request.Method, ct);

        var rows = await repository.ListCircleSettingsAsync(scope.All ? null : scope.CircleIds, ct);
        var row = rows.FirstOrDefault(item => item.CircleId == id)
                  ?? throw AppException.NotFound("الحلقة غير موجودة.");
        return Results.Ok(new MeetCircleSettingDto(
            row.CircleId, row.Name, row.IsActive, row.AutoRecord, row.AutoLink, row.UpcomingLinkedEvents));
    }

    private static async Task<IResult> SettingsAsync(MeetScopeRepository repository, CancellationToken ct)
    {
        var settings = await repository.GetSettingsAsync(ct);
        var dto = settings is null
            ? new MeetSettingsDto(true, 60, 120, 1, 25, 40, "8M", 24, false)
            : new MeetSettingsDto(
                settings.RecordingEnabled,
                settings.JoinLeadSeconds,
                settings.StopGraceSeconds,
                settings.MaxConcurrentSessions,
                settings.DiskBlockGb,
                settings.DiskWarnGb,
                settings.UploadBwLimit,
                settings.HlsRetentionHours,
                !string.IsNullOrWhiteSpace(settings.TelegramBotToken));
        return Results.Ok(dto);
    }
}
