namespace Dar.Common.Domain;

/// <summary>Single Cairo wall-clock helper for every module (FINAL Z2).</summary>
public static class CairoTime
{
    private static readonly TimeZoneInfo Zone = ResolveZone();

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

    public static DateTimeOffset Now() => TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, Zone);
    public static DateOnly Today() => DateOnly.FromDateTime(Now().DateTime);
    public static TimeOnly NowTime() => TimeOnly.FromDateTime(Now().DateTime);
    public static TimeOnly ToLocalTime(DateTimeOffset value) => TimeOnly.FromDateTime(TimeZoneInfo.ConvertTime(value, Zone).DateTime);
}