using System.Security.Claims;
using Dar.Common.Domain;
using Dar.Modules.Meet.Application;
using Dar.Modules.Meet.Infrastructure;
using Dar.Modules.Meet.Persistence;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Dar.Modules.Meet.Features.Calendar;

/// <summary>
/// Google Calendar OAuth and synchronisation endpoints. The callback is anonymous by
/// design: the legacy admin cookie is SameSite=Strict and is not sent on the cross-site
/// redirect from Google, so the signed state carries the actor id (ADR-0006).
/// </summary>
public static class CalendarEndpoints
{
    public static RouteGroupBuilder MapMeetCalendar(this RouteGroupBuilder group)
    {
        group.MapGet("/calendar/status", StatusAsync)
            .RequireAuthorization(MeetPermissions.View)
            .WithName("MeetCalendarStatus");
        group.MapPost("/calendar/connect", Connect)
            .RequireAuthorization(MeetPermissions.CalendarManage)
            .WithName("MeetCalendarConnect");
        group.MapGet("/calendar/callback", CallbackAsync)
            .AllowAnonymous()
            .WithName("MeetCalendarCallback");
        group.MapPost("/calendar/sync", SyncAsync)
            .RequireAuthorization(MeetPermissions.CalendarManage)
            .WithName("MeetCalendarSync");
        group.MapPost("/calendar/disconnect", DisconnectAsync)
            .RequireAuthorization(MeetPermissions.CalendarManage)
            .WithName("MeetCalendarDisconnect");
        return group;
    }

    private static async Task<IResult> StatusAsync(
        IOptions<MeetOptions> options,
        MeetCrypto crypto,
        MeetCalendarRepository repository,
        CancellationToken ct)
    {
        var settings = options.Value;
        var missing = settings.MissingPrerequisites();
        if (missing.Count > 0 || !crypto.IsReady)
            return Results.Ok(new MeetCalendarStatusDto(
                false, [.. missing], false, null, null, null, null, null, null, null, 0));

        var account = await repository.GetActiveAccountAsync(ct);
        if (account is null)
            return Results.Ok(new MeetCalendarStatusDto(
                true, [], false, null, null, null, null, null, null, null, 0));

        return Results.Ok(new MeetCalendarStatusDto(
            true, [], true, account.AccountEmail, account.CalendarId, account.Status,
            account.LastSyncAt, account.LastFullSyncAt, account.LastErrorCode,
            account.LastErrorMessage, account.ConsecutiveFailures));
    }

    private static IResult Connect(
        IOptions<MeetOptions> options,
        MeetCrypto crypto,
        MeetGoogleOAuth oauth,
        ClaimsPrincipal principal)
    {
        MeetGuards.EnsureConfigured(options.Value, crypto);
        var userId = MeetPrincipal.UserId(principal);
        if (userId == Guid.Empty) throw AppException.Unauthorized();

        var state = crypto.CreateState(userId, DateTimeOffset.UtcNow);
        return Results.Ok(new MeetConnectResponse(oauth.BuildAuthorizationUrl(state)));
    }

    private static async Task<IResult> CallbackAsync(
        string? code,
        string? state,
        string? error,
        IOptions<MeetOptions> options,
        MeetCrypto crypto,
        MeetGoogleOAuth oauth,
        MeetCalendarRepository repository,
        NpgsqlDataSource dataSource,
        HttpContext http,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        var logger = loggerFactory.CreateLogger("Dar.Modules.Meet.CalendarCallback");
        var settings = options.Value;

        if (!string.IsNullOrWhiteSpace(error)) return Redirect(settings, "denied");
        if (!crypto.TryReadState(state, DateTimeOffset.UtcNow, out var userId, out _))
            return Redirect(settings, "invalid_state");
        if (string.IsNullOrWhiteSpace(code)) return Redirect(settings, "invalid_code");

        try
        {
            var token = await oauth.ExchangeCodeAsync(code, ct);
            var email = await oauth.GetAccountEmailAsync(token.AccessToken, ct) ?? "google-account";
            var encrypted = crypto.Encrypt(token.RefreshToken!);
            var accountId = await repository.SaveAccountAsync(email, encrypted, token.Scope, userId, ct);
            await MeetAudit.WriteAsync(
                dataSource, StateActor(userId), "meet.calendar.connect", "meet_calendar_account", accountId,
                new { email }, http.Request.Path.ToString(), http.Request.Method, ct,
                userId, "ربط تقويم Google");
            logger.LogInformation("Meet calendar connected for account {AccountId}", accountId);
            return Redirect(settings, "connected");
        }
        catch (AppException exception)
        {
            logger.LogWarning("Meet calendar callback rejected: {Message}", exception.Message);
            return Redirect(settings, "error");
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogError(exception, "Meet calendar callback failed");
            return Redirect(settings, "error");
        }
    }

    private static async Task<IResult> SyncAsync(
        bool? full,
        IOptions<MeetOptions> options,
        MeetCrypto crypto,
        MeetCalendarRepository repository,
        CalendarSyncService syncService,
        NpgsqlDataSource dataSource,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        MeetGuards.EnsureConfigured(options.Value, crypto);
        var account = await repository.GetActiveAccountAsync(ct)
                      ?? throw new AppException("لم يُربط تقويم Google بعد. اضغط «ربط Google» أولًا.", 409);

        var result = await syncService.SyncAsync(account, full == true, ct);
        if (!result.Ok)
            throw new AppException(result.Message ?? "تعذّرت مزامنة تقويم Google.", 502);

        await MeetAudit.WriteAsync(
            dataSource, principal, "meet.calendar.sync", "meet_calendar_account", account.Id,
            new
            {
                result.FullResync,
                result.Added,
                result.Updated,
                result.Cancelled,
                result.AutoLinked
            },
            http.Request.Path.ToString(), http.Request.Method, ct);

        return Results.Ok(result);
    }

    private static async Task<IResult> DisconnectAsync(
        MeetCalendarRepository repository,
        NpgsqlDataSource dataSource,
        ClaimsPrincipal principal,
        HttpContext http,
        CancellationToken ct)
    {
        var account = await repository.GetActiveAccountAsync(ct);
        await repository.RevokeAccountsAsync(ct);
        if (account is not null)
        {
            await MeetAudit.WriteAsync(
                dataSource, principal, "meet.calendar.disconnect", "meet_calendar_account", account.Id,
                new { account.AccountEmail }, http.Request.Path.ToString(), http.Request.Method, ct);
        }

        return Results.Ok(new { ok = true });
    }

    private static IResult Redirect(MeetOptions settings, string result)
    {
        var path = string.IsNullOrWhiteSpace(settings.AdminRedirectPath) ? "/management" : settings.AdminRedirectPath;
        var separator = path.Contains('?') ? '&' : '?';
        return Results.Redirect($"{path}{separator}meet={Uri.EscapeDataString(result)}");
    }

    private static ClaimsPrincipal StateActor(Guid userId) =>
        new(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "meet-oauth"));
}
