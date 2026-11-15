namespace Dar.Modules.Secretariat.Domain;

public sealed class Student
{
    public Guid Id { get; set; }
    public string StudentCode { get; set; } = "";
    public string FullName { get; set; } = "";
    public int? AgeYears { get; set; }
    public string? Phone { get; set; }
    public string? GuardianName { get; set; }
    public string? GuardianPhone { get; set; }
    public DateOnly JoinedOn { get; set; }
    public string Status { get; set; } = "active";
    public string? Notes { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed record StudentResponse(
    Guid Id,
    string StudentCode,
    string FullName,
    int? AgeYears,
    string? Phone,
    string? GuardianName,
    string? GuardianPhone,
    DateOnly JoinedOn,
    string Status,
    string? Notes,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt)
{
    public static StudentResponse From(Student student) => new(
        student.Id,
        student.StudentCode,
        student.FullName,
        student.AgeYears,
        student.Phone,
        student.GuardianName,
        student.GuardianPhone,
        student.JoinedOn,
        student.Status,
        student.Notes,
        student.CreatedAt,
        student.UpdatedAt);
}

public static class StudentStatuses
{
    public static readonly string[] All = ["active", "paused", "withdrawn", "archived"];
    public static bool IsValid(string? status) =>
        status is not null && All.Contains(status, StringComparer.Ordinal);
}
