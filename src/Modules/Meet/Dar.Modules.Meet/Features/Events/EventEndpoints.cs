using System.Security.Claims;
using Dar.Common.Domain;
using Dar.Modules.Meet.Application;
using Dar.Modules.Meet.Domain;
using Dar.Modules.Meet.Persistence;
using Npgsql;

namespace Dar.Modules.Meet.Features.Events;

/// <summary>Calendar occurrences, circle linking and per-occurrence recording overrides.</summary>
public static class EventEndpoints
{
    private static readonly string[] Filters = ["all", "linked", "unlinked", "recording", "cancelled"];

    public static RouteGroupBuilder MapMeetEvents(this RouteGroupBuilder group)
    {
        group.MapGet("/events", ListAsync).RequireAuthorization(MeetPermissions.View).WithName("MeetEvents");
        group.MapCreateMeetEvent();
        group.MapPut("/events/{id:guid}/link", LinkAsync)
            .RequireAuthorization(MeetPermissions.Manage)
            .WithName("MeetEventLink");
        group.MapDelete("/events/{id:guid}/link", UnlinkAsync)
            .RequireAuthorization(MeetPermissions.Manage)
            .WithName("MeetEventUnlink");
        group.MapPut("/events/{id:guid}/recording", SetRecordingAsync)
            .RequireAuthorization(MeetPermissions.Manage)
            .WithName("MeetEventRecording");
        return group;
    }

    private static async Task<IResult> ListAsync(
        string? from,
        string? to,
        string? filter,
        string? search,
        int? page,
        int? pageSize,
        bool? meetOnly,
        MeetCalendarRepository repository,
        MeetScopeRepository scopeRepository,
        NpgsqlDataSource dataSource,
        ClaimsPrincipal principal,
        CancellationToken ct)
    {
        var today = MeetTime.TodayCairo();
        var fromDate = MeetTime.TryParseDate(from, out var parsedFrom) ? parsedFrom : today.AddDays(-7);
        var toDate = MeetTime.TryParseDate(to, out var parsedTo) ? parsedTo : today.AddDays(45);
        if (toDate < fromDate)
            throw AppException.Validation("to", "مدى التاريخ غير صحيح: تاريخ النهاية قبل البداية.");

        var pageNumber = Math.Max(1, page ?? 1);
        var size = Math.Clamp(pageSize ?? 25, 1, 100);
        var normalizedFilter = Filters.Contains(filter) ? filter! : "all";
        var startsAt = MeetTime.StartOfDay(fromDate);
        var endsAt = MeetTime.StartOfDay(toDate.AddDays(1));

        var scope = await MeetAccessScope.LoadAsync(dataSource, principal, ct);
        var account = await repository.GetActiveAccountAsync(ct);
        if (account is null)
            return Results.Ok(new MeetEventPageDto(startsAt, endsAt, pageNumber, size, 0, [], null));

        var (items, total) = await repository.ListEventsAsync(
            account.Id, startsAt, endsAt, normalizedFilter, search,
            scope.All ? null : scope.CircleIds, meetOnly ?? true, pageNumber, size, ct);
        var circles = await scopeRepository.ListCircleNamesAsync(scope.All ? null : scope.CircleIds, ct);
        var mapped = items.Select(item => ToDto(item, circles)).ToList();

        return Results.Ok(new MeetEventPageDto(startsAt, endsAt, pageNumber, size, total, mapped, null));
    }

    private static async Task<IResult> LinkAsync(
        Guid id,
        MeetLinkEventRequest request,
        MeetCalendarRepository repository,
        MeetScopeRepository scopeRepository,
        NpgsqlDataSource dataSource,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        if (request.CircleId == Guid.Empty)
            throw AppException.Validation("circleId", "اختَر حلقة صحيحة لربط الحدث.");

        var scope = await MeetAccessScope.LoadAsync(dataSource, principal, ct);
        if (!scope.All && !scope.AllowsCircle(request.CircleId))
            throw AppException.Forbidden("الحلقة خارج نطاق صلاحيتك.");

        var account = await RequireAccountAsync(repository, ct);
        var row = await repository.GetEventAsync(account.Id, id, ct)
                  ?? throw AppException.NotFound("الحدث غير موجود أو خارج نطاق المزامنة.");
        if (!await scopeRepository.CircleExistsAsync(request.CircleId, ct))
            throw AppException.Validation("circleId", "الحلقة غير موجودة أو تمت أرشفتها.");

        var actor = MeetPrincipal.UserId(principal);
        await scopeRepository.LinkAsync(id, request.CircleId, autoMatched: false, actor, ct);
        if (request.EnableRecording) await scopeRepository.SetCircleAutoRecordAsync(request.CircleId, true, actor, ct);

        await MeetAudit.WriteAsync(
            dataSource, principal, "meet.event.link", "meet_event", id,
            new { circleId = request.CircleId, enableRecording = request.EnableRecording, previousCircleId = row.LinkedCircleId },
            http.Request.Path.ToString(), http.Request.Method, ct);

        var updated = await repository.GetEventAsync(account.Id, id, ct);
        var circles = await scopeRepository.ListCircleNamesAsync(scope.All ? null : scope.CircleIds, ct);
        return Results.Ok(ToDto(updated ?? row, circles));
    }

    private static async Task<IResult> UnlinkAsync(
        Guid id,
        MeetCalendarRepository repository,
        MeetScopeRepository scopeRepository,
        NpgsqlDataSource dataSource,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        var scope = await MeetAccessScope.LoadAsync(dataSource, principal, ct);
        var account = await RequireAccountAsync(repository, ct);
        var row = await repository.GetEventAsync(account.Id, id, ct)
                  ?? throw AppException.NotFound("الحدث غير موجود أو خارج نطاق المزامنة.");
        if (!scope.All && !scope.AllowsCircle(row.LinkedCircleId))
            throw AppException.Forbidden("الحدث خارج نطاق صلاحيتك.");

        await scopeRepository.UnlinkAsync(id, ct);
        await MeetAudit.WriteAsync(
            dataSource, principal, "meet.event.unlink", "meet_event", id,
            new { previousCircleId = row.LinkedCircleId },
            http.Request.Path.ToString(), http.Request.Method, ct);
        return Results.Ok(new { ok = true });
    }

    private static async Task<IResult> SetRecordingAsync(
        Guid id,
        MeetRecordingModeRequest request,
        MeetCalendarRepository repository,
        MeetScopeRepository scopeRepository,
        NpgsqlDataSource dataSource,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        var mode = request.Mode?.Trim().ToLowerInvariant();
        if (!MeetRecordingPolicy.IsKnownMode(mode))
            throw AppException.Validation("mode", "القيمة المسموحة: inherit أو force أو exclude.");

        var scope = await MeetAccessScope.LoadAsync(dataSource, principal, ct);
        var account = await RequireAccountAsync(repository, ct);
        var row = await repository.GetEventAsync(account.Id, id, ct)
                  ?? throw AppException.NotFound("الحدث غير موجود أو خارج نطاق المزامنة.");
        if (!scope.All && !scope.AllowsCircle(row.LinkedCircleId))
            throw AppException.Forbidden("الحدث خارج نطاق صلاحيتك.");

        await scopeRepository.SetRecordingModeAsync(id, mode!, ct);
        await MeetAudit.WriteAsync(
            dataSource, principal, "meet.event.recording_mode", "meet_event", id,
            new { previous = row.RecordingMode, current = mode },
            http.Request.Path.ToString(), http.Request.Method, ct);

        var updated = await repository.GetEventAsync(account.Id, id, ct);
        var circles = await scopeRepository.ListCircleNamesAsync(scope.All ? null : scope.CircleIds, ct);
        return Results.Ok(ToDto(updated ?? row, circles));
    }

    private static async Task<MeetAccount> RequireAccountAsync(
        MeetCalendarRepository repository,
        CancellationToken ct) =>
        await repository.GetActiveAccountAsync(ct)
        ?? throw new AppException("لم يُربط تقويم Google بعد. اضغط «ربط Google» أولًا.", 409);

    private static MeetEventDto ToDto(MeetEventRow row, IReadOnlyList<(Guid Id, string Name)> circles)
    {
        var match = row.LinkedCircleId is null ? MeetCircleMatcher.Best(row.Summary, circles) : null;
        var linked = row.LinkedCircleId is not null;
        return new MeetEventDto(
            row.Id,
            row.GoogleEventId,
            row.Summary,
            row.MeetLink,
            row.HtmlLink,
            row.OccurrenceStart,
            row.OccurrenceEnd,
            row.TimeZone,
            row.GoogleStatus,
            row.IsRecurring,
            row.RecordingMode,
            row.LinkedCircleId,
            row.LinkedCircleName,
            row.LinkedAutomatically,
            match?.CircleId,
            match?.CircleName,
            match?.Confidence ?? 0,
            MeetRecordingPolicy.IsEligible(row.RecordingMode, linked, row.CircleAutoRecord, row.GoogleStatus));
    }
}
