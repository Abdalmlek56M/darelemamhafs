namespace Dar.Common.Requests;

public static class RequestStatus
{
    public const string Pending = "pending";
    public const string Approved = "approved";
    public const string Rejected = "rejected";
    public const string Cancelled = "cancelled";
}

public static class RequestWorkflow
{
    public static bool CanReview(string status) => status == RequestStatus.Pending;
    public static string ReviewStatus(bool approve) => approve ? RequestStatus.Approved : RequestStatus.Rejected;
    public static bool CanReopen(string status) => status == RequestStatus.Approved;
    public static bool CanEdit(string status) => status == RequestStatus.Pending;
    public static bool CanDelete(string status) => status != RequestStatus.Approved;
    public static bool CanCancel(string status) => status == RequestStatus.Pending;
}
