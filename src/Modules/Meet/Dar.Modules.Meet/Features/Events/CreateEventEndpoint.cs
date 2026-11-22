using System.Security.Claims;
using Dar.Common.Domain;
using Dar.Modules.Meet.Application;
using Dar.Modules.Meet.Infrastructure;
using Dar.Modules.Meet.Persistence;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Dar.Modules.Meet.Features.Events;

public sealed record CreateMeetEventRequest(
    Guid CircleId,
    string Title,
    string Date,
    string StartTime,
    int DurationMinutes,
    string? Description);

/// <summary>
/// Creates a session event in the Dar Google calendar with an attached Meet link, then
/// stores and links it locally. Requires the write scope (calendar.events); a token issued
/// with the old read-only scope fails with a clear "reconnect" message.
/// </summary>
public static class CreateEventEndpoint
{
    public static RouteGroupBuilder MapCreateMeetEvent(this RouteGroupBuilder group)
    {
        group.MapPost("/events", Handle)
            .RequireAuthorization(MeetPermissions.Manage)
            .WithName("MeetCreateEvent");
        return group;
    }

    private static async Task<IResult> Handle(
        CreateMeetEventRequest request,
        IOptions<MeetOptions> options,
        MeetCrypto crypto,
        MeetGoogleOAuth oauth,
        MeetGoogleCalendarClient google,
        MeetCalendarRepository repository,
        MeetScopeRepository scopeRepository,
        NpgsqlDataSource dataSource,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        MeetGuards.EnsureConfigured(options.Value, crypto);

        var title = (request.Title ?? string.Empty).Trim();
        if (title.Length is < 3 or > 500)
            throw AppException.Validation("title", "عنوان الحصة يجب أن يكون بين 3 و500 حرف.");
        if (request.DurationMinutes is < 15 or > 240)
            throw AppException.Validation("durationMinutes", "مدة الحصة يجب أن تكون بين 15 و240 دقيقة.");
        if (!MeetTime.TryParseDate(request.Date, out var date))
            throw AppException.Validation("date", "التاريخ غير صالح.");
        if (!TimeOnly.TryParseExact(request.StartTime ?? string.Empty, "HH:mm", out var time))
            throw AppException.Validation("startTime", "الوقت غير صالح (HH:mm).");

        var today = MeetTime.TodayCairo();
        if (date < today.AddDays(-1) || date > today.AddDays(120))
            throw AppException.Validation("date", "التاريخ يجب أن يكون بين الأمس و120 يومًا قادمة.");

        var scope = await MeetAccessScope.LoadAsync(dataSource, principal, ct);
        if (request.CircleId != Guid.Empty && !scope.All && !scope.AllowsCircle(request.CircleId))
            throw AppException.Forbidden("الحلقة خارج نطاق صلاحيتك.");
        if (request.CircleId != Guid.Empty && !await scopeRepository.CircleExistsAsync(request.CircleId, ct))
            throw AppException.Validation("circleId", "الحلقة غير موجودة أو تمت أرشفتها.");

        var account = await repository.GetActiveAccountAsync(ct)
                      ?? throw new AppException("لم يُربط تقويم Google بعد.", 409);

        string refreshToken;
        try
        {
            refreshToken = crypto.Decrypt(account.EncryptedRefreshToken);
        }
        catch (Exception exception) when (exception is InvalidOperationException or System.Security.Cryptography.CryptographicException)
        {
            throw new AppException("تعذّر فك تشفير تصريح Google. أعد ربط التقويم.", 409);
        }

        var refresh = await oauth.RefreshAsync(refreshToken, ct);
        if (refresh.Token is null)
            throw new AppException(refresh.Message ?? "تعذّر تجديد تصريح Google.", 409);

        var start = MeetTime.FromCairo(date, time);
        var end = start.AddMinutes(request.DurationMinutes);

        GoogleCalendarEvent created;
        try
        {
            created = await google.CreateEventAsync(
                refresh.Token.AccessToken,
                account.CalendarId,
                title,
                string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
                start,
                end,
                "Africa/Cairo",
                ct);
        }
        catch (MeetGoogleException exception)
        {
            var status = exception.StatusCode switch
            {
                401 => 409,
                403 => 409,
                _ => 502
            };
            throw new AppException(exception.Message, status);
        }

        await repository.UpsertEventsAsync(account.Id, account.CalendarId, [created], ct);
        var eventId = await repository.FindEventIdAsync(account.Id, created.Id, created.Start, ct)
                      ?? throw new AppException("تم إنشاء الموعد في Google لكن تعذّر حفظه محليًا. شغّل مزامنة.", 500);

        if (request.CircleId != Guid.Empty)
        {
            await scopeRepository.LinkAsync(
                eventId, request.CircleId, autoMatched: false, MeetPrincipal.UserId(principal), ct);
        }

        await MeetAudit.WriteAsync(
            dataSource, principal, "meet.event.create", "meet_event", eventId,
            new { googleEventId = created.Id, circleId = request.CircleId, startsAt = created.Start, durationMinutes = request.DurationMinutes },
            http.Request.Path.ToString(), http.Request.Method, ct);

        return Results.Ok(new
        {
            id = eventId,
            googleEventId = created.Id,
            summary = created.Summary,
            startsAt = created.Start,
            endsAt = created.End,
            meetLink = created.MeetLink,
            htmlLink = created.HtmlLink,
            circleId = request.CircleId == Guid.Empty ? (Guid?)null : request.CircleId
        });
    }
}
