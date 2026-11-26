using Dar.Modules.Meet.Domain;
using Dar.Modules.Meet.Infrastructure;
using Dar.Modules.Meet.Persistence;

namespace Dar.Modules.Meet.Application;

/// <summary>
/// Pulls Google Calendar changes into meet_events (incremental via syncToken, full resync
/// every <see cref="MeetOptions.FullSyncHours"/>) and auto-links unambiguous event names.
/// A single process-wide gate keeps the background worker and the manual sync endpoint
/// from racing on the same syncToken.
/// </summary>
public sealed class CalendarSyncService(
    MeetCalendarRepository calendarRepository,
    MeetScopeRepository scopeRepository,
    MeetGoogleOAuth oauth,
    MeetGoogleCalendarClient google,
    MeetCrypto crypto,
    IOptions<MeetOptions> options,
    ILogger<CalendarSyncService> logger)
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private MeetOptions Options => options.Value;

    public async Task<MeetSyncResponse> SyncAsync(MeetAccount account, bool forceFull, CancellationToken ct)
    {
        if (!Options.IsConfigured || !crypto.IsReady)
            throw new InvalidOperationException("Meet module is not configured.");

        await Gate.WaitAsync(ct);
        try
        {
            return await SyncCoreAsync(account, forceFull, ct);
        }
        finally
        {
            Gate.Release();
        }
    }

    public bool NeedsFullSync(MeetAccount account)
    {
        if (string.IsNullOrWhiteSpace(account.SyncToken)) return true;
        if (account.LastFullSyncAt is not { } lastFull) return true;
        return DateTimeOffset.UtcNow - lastFull > TimeSpan.FromHours(Options.FullSyncHours);
    }

    private async Task<MeetSyncResponse> SyncCoreAsync(MeetAccount account, bool forceFull, CancellationToken ct)
    {
        string refreshToken;
        try
        {
            refreshToken = crypto.Decrypt(account.EncryptedRefreshToken);
        }
        catch (Exception exception) when (exception is InvalidOperationException or System.Security.Cryptography.CryptographicException)
        {
            logger.LogError(exception, "Stored Meet refresh token could not be decrypted for account {AccountId}", account.Id);
            await calendarRepository.SaveSyncFailureAsync(
                account.Id, "token_unreadable", "تعذّر فك تشفير تصريح Google. أعد الربط.", true, ct);
            return Failure("تعذّر فك تشفير تصريح Google المحفوظ. أعد ربط التقويم.", forceFull);
        }

        var refresh = await oauth.RefreshAsync(refreshToken, ct);
        if (refresh.Token is null)
        {
            await calendarRepository.SaveSyncFailureAsync(
                account.Id, refresh.ErrorCode ?? "refresh_failed", refresh.Message ?? "تعذّر تجديد التصريح.",
                refresh.NeedsReconnect, ct);
            return Failure(refresh.Message ?? "تعذّر تجديد تصريح Google.", forceFull);
        }

        var full = forceFull || NeedsFullSync(account);
        var accessToken = refresh.Token.AccessToken;
        var autoLinked = 0;

        for (var attempt = 0; attempt < 2; attempt++)
        {
            PassResult pass;
            try
            {
                pass = await RunPassAsync(account, accessToken, full, ct);
            }
            catch (MeetGoogleException exception) when (exception.StatusCode == 401)
            {
                await calendarRepository.SaveSyncFailureAsync(
                    account.Id, "unauthorized", "انتهت صلاحية تصريح Google.", true, ct);
                return Failure("انتهت صلاحية ربط تقويم Google. أعد الربط من صفحة التسجيل.", forceFull);
            }
            catch (MeetGoogleException exception)
            {
                logger.LogWarning(exception, "Google Calendar sync failed for account {AccountId}", account.Id);
                await calendarRepository.SaveSyncFailureAsync(
                    account.Id, "google_" + exception.StatusCode, exception.Message, false, ct);
                return Failure(exception.Message, full);
            }

            if (pass.SyncTokenExpired)
            {
                if (full) return Failure("تعذّر إكمال المزامنة الكاملة مع Google. أعد المحاولة.", true);
                full = true;
                continue;
            }

            await calendarRepository.SaveSyncSuccessAsync(account.Id, pass.NextSyncToken, full, ct);
            autoLinked = await AutoLinkAsync(account.Id, ct);
            logger.LogInformation(
                "Meet calendar sync: full={Full} added={Added} updated={Updated} cancelled={Cancelled} autoLinked={AutoLinked}",
                full, pass.Added, pass.Updated, pass.Cancelled, autoLinked);

            return new MeetSyncResponse(
                true, full, pass.Added, pass.Updated, pass.Cancelled, autoLinked, DateTimeOffset.UtcNow, null);
        }

        return Failure("تعذّر إكمال مزامنة التقويم.", true);
    }

    private async Task<PassResult> RunPassAsync(
        MeetAccount account,
        string accessToken,
        bool full,
        CancellationToken ct)
    {
        var timeMin = DateTimeOffset.UtcNow.AddDays(-Math.Max(1, Options.SyncWindowDaysBack));
        var timeMax = DateTimeOffset.UtcNow.AddDays(Math.Max(1, Options.SyncWindowDaysAhead));
        var syncToken = full ? null : account.SyncToken;
        string? pageToken = null;
        string? nextSyncToken = null;
        var added = 0;
        var updated = 0;
        var cancelled = 0;

        do
        {
            var page = await google.ListEventsAsync(
                accessToken,
                account.CalendarId,
                full ? timeMin : null,
                full ? timeMax : null,
                syncToken,
                pageToken,
                ct);

            if (page.SyncTokenExpired)
                return new PassResult(true, added, updated, cancelled, nextSyncToken);

            var result = await calendarRepository.UpsertEventsAsync(account.Id, account.CalendarId, page.Events, ct);
            added += result.Added;
            updated += result.Updated;
            cancelled += result.Cancelled;
            if (!string.IsNullOrWhiteSpace(page.NextSyncToken)) nextSyncToken = page.NextSyncToken;
            pageToken = page.NextPageToken;
        }
        while (!string.IsNullOrWhiteSpace(pageToken));

        return new PassResult(false, added, updated, cancelled, nextSyncToken);
    }

    /// <summary>
    /// Smart linking: an unambiguous circle-name match inside the event summary links the
    /// occurrence automatically. Manual links are never overwritten.
    /// </summary>
    private async Task<int> AutoLinkAsync(Guid accountId, CancellationToken ct)
    {
        var circles = await scopeRepository.ListCircleSettingsAsync(null, ct);
        var linkable = circles
            .Where(circle => circle.AutoLink && !string.IsNullOrWhiteSpace(circle.Name))
            .Select(circle => (circle.CircleId, circle.Name))
            .ToList();
        if (linkable.Count == 0) return 0;

        var linked = 0;
        var from = DateTimeOffset.UtcNow.AddDays(-Math.Max(1, Options.SyncWindowDaysBack));
        var to = DateTimeOffset.UtcNow.AddDays(Math.Max(1, Options.SyncWindowDaysAhead));

        for (var page = 1; page <= 5; page++)
        {
            var (items, _) = await calendarRepository.ListEventsAsync(
                accountId, from, to, "unlinked", null, null, false, page, 200, ct);
            if (items.Count == 0) break;

            foreach (var item in items)
            {
                if (string.IsNullOrWhiteSpace(item.MeetLink)) continue;
                if (item.GoogleStatus == "cancelled") continue;

                var match = MeetCircleMatcher.BestUnambiguous(item.Summary, linkable);
                if (match is null || match.Confidence < Options.AutoLinkMinConfidence) continue;
                if (await scopeRepository.LinkIfUnlinkedAsync(item.Id, match.CircleId, ct)) linked++;
            }

            if (items.Count < 200) break;
        }

        return linked;
    }

    private static MeetSyncResponse Failure(string message, bool full) =>
        new(false, full, 0, 0, 0, 0, null, message);

    private sealed record PassResult(bool SyncTokenExpired, int Added, int Updated, int Cancelled, string? NextSyncToken);
}
