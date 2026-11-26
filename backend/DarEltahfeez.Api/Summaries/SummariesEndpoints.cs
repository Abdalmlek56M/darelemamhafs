namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    internal static void MapSummaries(WebApplication app)
    {
        MapCollectionsSummary(app);
        MapTeacherAttendanceSummary(app);
        MapFinanceEntryOptionsSummary(app);
    }
}
