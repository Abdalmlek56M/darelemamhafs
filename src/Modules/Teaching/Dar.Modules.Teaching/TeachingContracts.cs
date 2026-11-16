namespace Dar.Modules.Teaching;

public sealed record StartSessionRequest(Guid ScheduleSlotId);
public sealed record EndSessionRequest(string? Note);
public sealed record AttendanceMark(Guid EnrollmentId, string Status, string? Note);
public sealed record SubmitAttendanceRequest(AttendanceMark[] Students);
public sealed record AdjustAttendanceRequest(int PayableDurationMinutes, decimal? PayableAmount, string Note);
public sealed record ResolveNotificationRequest(string Note);
