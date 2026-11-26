namespace Dar.Common.Domain;

/// <summary>FINAL 1.11: the operational day is Africa/Cairo, independent of the server/browser clock.</summary>
public static class CairoTime
{
    private static readonly TimeZoneInfo Zone = ResolveZone();

    public static DateOnly Today() => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Zone));

    private static TimeZoneInfo ResolveZone()
    {
        foreach (var id in new[] { "Africa/Cairo", "Egypt Standard Time" })
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
            catch (TimeZoneNotFoundException) { }
            catch (InvalidTimeZoneException) { }
        }
        return TimeZoneInfo.Utc;
    }
}
