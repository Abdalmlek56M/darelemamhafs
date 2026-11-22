using System.Globalization;

namespace Dar.Modules.Meet.Application;

/// <summary>
/// Cairo wall-clock helpers. Calendar values are stored in UTC; the UI selects dates
/// in Africa/Cairo, matching every other date boundary in the system (docs/01).
/// </summary>
public static class MeetTime
{
    private static readonly TimeZoneInfo Zone = ResolveZone();

    private static TimeZoneInfo ResolveZone()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("Africa/Cairo"); }
        catch (TimeZoneNotFoundException) { return TimeZoneInfo.FindSystemTimeZoneById("Egypt Standard Time"); }
    }

    public static DateOnly TodayCairo() =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, Zone).DateTime);

    public static DateTimeOffset StartOfDay(DateOnly date) =>
        new(date.ToDateTime(TimeOnly.MinValue), Zone.GetUtcOffset(date.ToDateTime(TimeOnly.MinValue)));

    public static bool TryParseDate(string? value, out DateOnly date)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            date = default;
            return false;
        }

        return DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);
    }
}
