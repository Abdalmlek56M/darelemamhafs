using Dar.Common.Domain;
using Dar.Modules.Meet.Application;
using Dar.Modules.Meet.Infrastructure;
using Dar.Modules.Meet.Persistence;
using Microsoft.Extensions.Options;

namespace Dar.Modules.Meet.Features.Control;

public sealed record ManualJoinRequest(string? Url, string? Title);
public sealed record PauseRequest(bool Paused);
public sealed record MeetSettingsRequest(
    int? JoinLeadSeconds,
    int? StopGraceSeconds,
    int? DiskWarnGb,
    int? DiskBlockGb,
    string? DefaultAccessType,
    int? MaxSessionMinutes,
    int? HlsRetentionHours,
    string? AlertEmail,
    string? TelegramBotToken,
    string? TelegramChatId);
public sealed record EventAccessRequest(string? AccessType);

/// <summary>
/// Owner controls over the recorder: start on any Meet link, stop, pause/resume, and read
/// the operational alerts. Recording is deliberately restricted to Google Meet hosts.
/// </summary>
public static class ControlEndpoints
{
    private const string MeetHost = "meet.google.com";
    private const int MaxManualSessionSeconds = 21600;

    public static RouteGroupBuilder MapMeetControl(this RouteGroupBuilder group)
    {
        group.MapPost("/bot/join", JoinAsync).RequireAuthorization(MeetPermissions.BotControl).WithName("MeetBotJoin");
        group.MapGet("/bot/active", ActiveAsync).RequireAuthorization(MeetPermissions.BotControl).WithName("MeetBotActive");
        group.MapPost("/jobs/{id:guid}/stop", StopAsync).RequireAuthorization(MeetPermissions.BotControl).WithName("MeetBotStop");
        group.MapPost("/jobs/{id:guid}/pause", PauseAsync).RequireAuthorization(MeetPermissions.BotControl).WithName("MeetBotPause");
        group.MapGet("/alerts", AlertsAsync).RequireAuthorization(MeetPermissions.View).WithName("MeetAlerts");
        group.MapPost("/alerts/read", MarkReadAsync).RequireAuthorization(MeetPermissions.View).WithName("MeetAlertsRead");
        group.MapPut("/settings", UpdateSettingsAsync).RequireAuthorization(MeetPermissions.BotControl).WithName("MeetSettingsUpdate");
        group.MapPost("/events/{id:guid}/access", SetEventAccessAsync).RequireAuthorization(MeetPermissions.Manage).WithName("MeetEventAccess");
        return group;
    }

    private static async Task<IResult> JoinAsync(
        ManualJoinRequest request,
        HttpContext context,
        MeetBotJobRepository repository,
        IOptions<MeetOptions> options,
        MeetCrypto crypto,
        CancellationToken ct)
    {
        MeetGuards.EnsureConfigured(options.Value, crypto);

        var link = NormalizeMeetLink(request.Url);
        var jobId = await repository.CreateManualJobAsync(
            link,
            string.IsNullOrWhiteSpace(request.Title) ? "تسجيل يدوي" : request.Title.Trim(),
            MeetPrincipal.UserId(context.User),
            MaxManualSessionSeconds,
            ct);
        return Results.Ok(new { jobId, meetLink = link, message = "تم إرسال البوت للانضمام الآن." });
    }

    private static async Task<IResult> ActiveAsync(MeetBotJobRepository repository, CancellationToken ct)
    {
        var job = await repository.GetActiveAsync(ct);
        return job is null
            ? Results.Ok(new { active = false })
            : Results.Ok(new
            {
                active = true,
                id = job.Id,
                status = job.Status,
                summary = job.Summary,
                meetLink = job.MeetLink,
                startedAt = job.StartedAt,
                scheduledEnd = job.ScheduledEnd,
                participants = job.Participants,
                paused = job.Paused,
                stopRequested = job.StopRequested
            });
    }

    private static async Task<IResult> StopAsync(Guid id, MeetBotJobRepository repository, CancellationToken ct)
    {
        var accepted = await repository.RequestStopAsync(id, ct);
        return accepted
            ? Results.Ok(new { message = "تم إرسال أمر الإيقاف؛ سيُنهي البوت التسجيل خلال ثوانٍ." })
            : throw AppException.Conflict("لا توجد مهمة جارية بهذا المعرّف.");
    }

    private static async Task<IResult> PauseAsync(Guid id, PauseRequest request, MeetBotJobRepository repository, CancellationToken ct)
    {
        var accepted = await repository.SetPausedAsync(id, request.Paused, ct);
        return accepted
            ? Results.Ok(new { paused = request.Paused })
            : throw AppException.Conflict("لا توجد مهمة جارية بهذا المعرّف.");
    }

    private static async Task<IResult> AlertsAsync(int? limit, bool? unread, MeetAlertRepository repository, CancellationToken ct)
    {
        var rows = await repository.ListAsync(limit ?? 30, unread ?? false, ct);
        return Results.Ok(new
        {
            count = rows.Count,
            unread = rows.Count(row => !row.IsRead),
            alerts = rows.Select(row => new
            {
                id = row.Id,
                severity = row.Severity,
                code = row.Code,
                title = row.Title,
                body = row.Body,
                createdAt = row.CreatedAt,
                isRead = row.IsRead
            })
        });
    }

    private static async Task<IResult> MarkReadAsync(Guid? id, MeetAlertRepository repository, CancellationToken ct)
        => Results.Ok(new { updated = await repository.MarkReadAsync(id, ct) });

    /// <summary>Owner-editable recording settings (lead, grace, disk, access, cap).</summary>
    private static async Task<IResult> UpdateSettingsAsync(
        MeetSettingsRequest request,
        MeetScopeRepository repository,
        MeetCrypto crypto,
        CancellationToken ct)
    {
        var current = await repository.GetSettingsAsync(ct)
                      ?? throw AppException.NotFound("إعدادات التسجيل غير موجودة.");

        var access = request.DefaultAccessType?.Trim().ToLowerInvariant() ?? current.DefaultAccessType;
        if (access is not ("open" or "trusted"))
            throw AppException.Validation("defaultAccessType", "نوع الوصول يجب أن يكون open أو trusted.");

        var lead = request.JoinLeadSeconds ?? current.JoinLeadSeconds;
        if (lead is < 10 or > 600)
            throw AppException.Validation("joinLeadSeconds", "مهلة الانضمام بين 10 و600 ثانية.");

        var grace = request.StopGraceSeconds ?? current.StopGraceSeconds;
        if (grace is < 0 or > 900)
            throw AppException.Validation("stopGraceSeconds", "مهلة الإيقاف بين 0 و900 ثانية.");

        var warn = request.DiskWarnGb ?? current.DiskWarnGb;
        var block = request.DiskBlockGb ?? current.DiskBlockGb;
        if (warn < block)
            throw AppException.Validation("diskWarnGb", "حد التنبيه يجب أن يكون أكبر من حد المنع.");

        var maxSession = request.MaxSessionMinutes ?? current.MaxSessionMinutes;
        if (maxSession is < 5 or > 720)
            throw AppException.Validation("maxSessionMinutes", "أقصى مدة بين 5 و720 دقيقة.");

        var hls = request.HlsRetentionHours ?? current.HlsRetentionHours;
        var tokenToStore = ResolveTelegramToken(request.TelegramBotToken, current.TelegramBotToken, crypto);
        var chatToStore = string.IsNullOrWhiteSpace(request.TelegramChatId)
            ? current.TelegramChatId
            : request.TelegramChatId.Trim();
        var updated = await repository.UpdateSettingsAsync(
            lead, grace, warn, block, access, maxSession, hls,
            string.IsNullOrWhiteSpace(request.AlertEmail) ? null : request.AlertEmail.Trim(),
            tokenToStore,
            chatToStore,
            ct);
        if (updated is null) throw AppException.NotFound("إعدادات التسجيل غير موجودة.");
        return Results.Ok(new MeetSettingsDto(
            updated.RecordingEnabled,
            updated.JoinLeadSeconds,
            updated.StopGraceSeconds,
            updated.MaxConcurrentSessions,
            updated.DiskBlockGb,
            updated.DiskWarnGb,
            updated.UploadBwLimit,
            updated.HlsRetentionHours,
            !string.IsNullOrWhiteSpace(updated.TelegramBotToken)));
    }

    /// <summary>
    /// FINAL 0.5: the bot token is stored encrypted exactly like the Google refresh token.
    /// A blank request keeps the stored value (never wipes it); a legacy plaintext value is
    /// encrypted on the next save. The response never carries the token itself.
    /// </summary>
    private static string? ResolveTelegramToken(string? requested, string? stored, MeetCrypto crypto)
    {
        if (!string.IsNullOrWhiteSpace(requested))
        {
            if (!crypto.IsReady)
                throw AppException.Validation("telegramBotToken", "مفتاح التشفير غير مهيأ على الخادم؛ لا يمكن حفظ التوكن الآن.");
            return crypto.Encrypt(requested.Trim());
        }
        if (string.IsNullOrWhiteSpace(stored)) return null;
        if (crypto.TryDecrypt(stored, out _)) return stored;
        return crypto.IsReady ? crypto.Encrypt(stored) : stored;
    }

    /// <summary>open/trusted override for one event; null restores the module default.</summary>
    private static async Task<IResult> SetEventAccessAsync(
        Guid id,
        EventAccessRequest request,
        MeetScopeRepository repository,
        CancellationToken ct)
    {
        var value = request.AccessType?.Trim().ToLowerInvariant();
        if (value is not (null or "" or "open" or "trusted"))
            throw AppException.Validation("accessType", "نوع الوصول يجب أن يكون open أو trusted أو فارغًا.");

        var normalized = string.IsNullOrEmpty(value) ? null : value;
        var ok = await repository.SetEventAccessAsync(id, normalized, ct);
        return ok
            ? Results.Ok(new { accessType = normalized })
            : throw AppException.NotFound("الحدث غير موجود.");
    }

    /// <summary>Accepts only https://meet.google.com/&lt;code&gt; links, with an optional query.</summary>
    private static string NormalizeMeetLink(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            throw AppException.Validation("url", "أدخل رابط Google Meet.");

        if (!Uri.TryCreate(raw.Trim(), UriKind.Absolute, out var uri))
            throw AppException.Validation("url", "الرابط غير صالح.");

        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            throw AppException.Validation("url", "الرابط يجب أن يبدأ بـ https.");

        if (!string.Equals(uri.Host, MeetHost, StringComparison.OrdinalIgnoreCase))
            throw AppException.Validation("url", "التسجيل مدعوم لروابط Google Meet فقط (meet.google.com).");

        var code = uri.AbsolutePath.Trim('/');
        if (code.Length < 5 || code.Contains('/'))
            throw AppException.Validation("url", "رابط الاجتماع غير مكتمل.");

        return $"https://{MeetHost}/{code}";
    }
}
