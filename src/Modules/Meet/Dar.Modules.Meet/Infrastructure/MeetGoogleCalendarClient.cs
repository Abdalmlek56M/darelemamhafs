using System.Globalization;
using System.Net;
using System.Text.Json;

namespace Dar.Modules.Meet.Infrastructure;

/// <summary>One Google Calendar occurrence, parsed and ready to persist.</summary>
public sealed record GoogleCalendarEvent(
    string Id,
    string Status,
    string? Summary,
    string? Description,
    string? Location,
    string? HtmlLink,
    string? MeetLink,
    string? OrganizerEmail,
    DateTimeOffset Start,
    DateTimeOffset End,
    string? TimeZone,
    bool IsRecurring,
    string RawJson);

public sealed record CalendarPage(
    IReadOnlyList<GoogleCalendarEvent> Events,
    string? NextPageToken,
    string? NextSyncToken,
    bool SyncTokenExpired);

public sealed class MeetGoogleException(string message, int statusCode, string? reason = null) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
    public string? Reason { get; } = reason;
}

/// <summary>Read-only Google Calendar events.list client (incremental via syncToken).</summary>
public sealed class MeetGoogleCalendarClient
{
    private const string BaseUrl = "https://www.googleapis.com/calendar/v3/calendars";
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(45) };

    public async Task<CalendarPage> ListEventsAsync(
        string accessToken,
        string calendarId,
        DateTimeOffset? timeMin,
        DateTimeOffset? timeMax,
        string? syncToken,
        string? pageToken,
        CancellationToken ct)
    {
        var query = new List<string> { "singleEvents=true", "showDeleted=true", "maxResults=250" };
        if (!string.IsNullOrWhiteSpace(syncToken))
        {
            query.Add("syncToken=" + Uri.EscapeDataString(syncToken));
        }
        else
        {
            query.Add("orderBy=startTime");
            if (timeMin is { } min) query.Add("timeMin=" + Uri.EscapeDataString(Format(min)));
            if (timeMax is { } max) query.Add("timeMax=" + Uri.EscapeDataString(Format(max)));
        }
        if (!string.IsNullOrWhiteSpace(pageToken))
            query.Add("pageToken=" + Uri.EscapeDataString(pageToken));

        var url = $"{BaseUrl}/{Uri.EscapeDataString(calendarId)}/events?{string.Join('&', query)}";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);

        using var response = await Http.SendAsync(request, ct);
        if (response.StatusCode == HttpStatusCode.Gone)
            return new CalendarPage([], null, null, true);

        if (response.StatusCode == HttpStatusCode.Unauthorized)
            throw new MeetGoogleException("انتهت صلاحية تصريح Google.", 401, "unauthorized");

        if (response.StatusCode == HttpStatusCode.NotFound)
            throw new MeetGoogleException("تقويم Google غير موجود لهذا الحساب.", 404, "not_found");

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new MeetGoogleException(
                $"تعذّر قراءة تقويم Google ({(int)response.StatusCode}).",
                (int)response.StatusCode,
                ExtractReason(body));
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
        var root = document.RootElement;

        var events = new List<GoogleCalendarEvent>();
        if (root.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in items.EnumerateArray())
            {
                var parsed = ParseEvent(item);
                if (parsed is not null) events.Add(parsed);
            }
        }

        return new CalendarPage(
            events,
            ReadString(root, "nextPageToken"),
            ReadString(root, "nextSyncToken"),
            false);
    }

    private static GoogleCalendarEvent? ParseEvent(JsonElement item)
    {
        var id = ReadString(item, "id");
        if (string.IsNullOrWhiteSpace(id)) return null;

        var start = ReadDate(item, "start");
        var end = ReadDate(item, "end");
        if (start is null || end is null || end <= start) return null;

        var status = ReadString(item, "status") ?? "confirmed";
        var timeZone = item.TryGetProperty("start", out var startElement)
            ? ReadString(startElement, "timeZone")
            : null;

        return new GoogleCalendarEvent(
            id,
            status,
            ReadString(item, "summary"),
            ReadString(item, "description"),
            ReadString(item, "location"),
            ReadString(item, "htmlLink"),
            ReadString(item, "hangoutLink"),
            item.TryGetProperty("organizer", out var organizer) ? ReadString(organizer, "email") : null,
            start.Value,
            end.Value,
            timeZone,
            !string.IsNullOrWhiteSpace(ReadString(item, "recurringEventId")),
            item.GetRawText());
    }

    private static DateTimeOffset? ReadDate(JsonElement item, string name)
    {
        if (!item.TryGetProperty(name, out var element)) return null;
        var value = ReadString(element, "dateTime");
        if (string.IsNullOrWhiteSpace(value)) return null; // all-day events have no time and no Meet link
        return DateTimeOffset.TryParse(
            value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed)
            ? parsed
            : null;
    }

    private static string Format(DateTimeOffset value) =>
        value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);

    private static string? ReadString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string? ExtractReason(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.TryGetProperty("error", out var error) &&
                error.TryGetProperty("errors", out var errors) &&
                errors.ValueKind == JsonValueKind.Array && errors.GetArrayLength() > 0)
            {
                return ReadString(errors[0], "reason");
            }
        }
        catch (JsonException)
        {
            // Fall through: the message stays generic.
        }
        return null;
    }
}
