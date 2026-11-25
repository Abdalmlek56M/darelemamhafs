using System.Security.Claims;
using Dar.Common.Domain;
using Dar.Modules.Secretariat.Abstractions;
using Dar.Modules.Secretariat.Domain;

namespace Dar.Modules.Secretariat.Features.CreateStudent;

public sealed record CreateStudentRequest(
    string? StudentCode,
    string FullName,
    int? AgeYears,
    string? Phone,
    string? GuardianName,
    string? GuardianPhone,
    DateOnly JoinedOn,
    string Status,
    string? Notes);

public sealed class CreateStudentHandler(IStudentRepository repository)
{
    public async Task<StudentResponse> HandleAsync(
        CreateStudentRequest request,
        Guid actorId,
        CancellationToken cancellationToken)
    {
        var errors = Validate(request);
        if (errors is not null) throw new AppException("بيانات الطالبة غير صالحة.", 422, errors);

        var code = string.IsNullOrWhiteSpace(request.StudentCode)
            ? BuildCode()
            : request.StudentCode.Trim();

        if (code.Length > 40)
            throw AppException.Validation("studentCode", "كود الطالبة يجب ألا يتجاوز 40 حرفًا.");

        if (await repository.CodeExistsAsync(code, cancellationToken))
            throw AppException.Conflict("كود الطالبة مستخدم بالفعل.");

        var student = new Student
        {
            StudentCode = code,
            FullName = request.FullName.Trim(),
            AgeYears = request.AgeYears,
            Phone = Normalize(request.Phone),
            GuardianName = Normalize(request.GuardianName),
            GuardianPhone = Normalize(request.GuardianPhone),
            // The Dar operates in Africa/Cairo; DateTime.Today avoids the UTC date rolling
            // back to "yesterday" for students created between midnight and 02:00 local time.
            JoinedOn = request.JoinedOn == default ? DateOnly.FromDateTime(DateTime.Today) : request.JoinedOn,
            Status = request.Status,
            Notes = Normalize(request.Notes)
        };

        await repository.CreateAsync(student, actorId, cancellationToken);
        return StudentResponse.From(student);
    }

    private static Dictionary<string, string[]>? Validate(CreateStudentRequest request)
    {
        var errors = new Dictionary<string, string[]>();

        if (string.IsNullOrWhiteSpace(request.FullName) || request.FullName.Trim().Length > 180)
            errors["fullName"] = ["اسم الطالبة مطلوب وبحد أقصى 180 حرفًا."];

        if (request.AgeYears is < 0 or > 120)
            errors["ageYears"] = ["العمر يجب أن يكون بين صفر و120 سنة."];

        if (HasInvalidPhoneChars(request.Phone))
            errors["phone"] = ["رقم الهاتف يجب أن يحتوي أرقامًا فقط مع الرموز + - ( ) والمسافات، بحد أقصى 40 حرفًا."];

        if (request.GuardianName?.Trim().Length > 180)
            errors["guardianName"] = ["اسم ولي الأمر يجب ألا يتجاوز 180 حرفًا."];

        if (HasInvalidPhoneChars(request.GuardianPhone))
            errors["guardianPhone"] = ["هاتف ولي الأمر يجب أن يحتوي أرقامًا فقط مع الرموز + - ( ) والمسافات، بحد أقصى 40 حرفًا."];

        if (!StudentStatuses.IsValid(request.Status))
            errors["status"] = ["حالة الطالبة غير صحيحة."];

        if (request.Notes?.Length > 10_000)
            errors["notes"] = ["الملاحظات يجب ألا تتجاوز 10,000 حرف."];

        return errors.Count == 0 ? null : errors;
    }

    private static bool HasInvalidPhoneChars(string? value)
    {
        var trimmed = value?.Trim() ?? string.Empty;
        return trimmed.Length > 40 || trimmed.Any(ch => !(char.IsAsciiDigit(ch) || ch is '+' or ' ' or '-' or '(' or ')'));
    }

    private static string? Normalize(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string BuildCode() =>
        $"STD-{DateTime.UtcNow:yyyyMMddHHmmss}-{Random.Shared.Next(1000, 9999)}";
}

public static class CreateStudentEndpoint
{
    public static RouteGroupBuilder MapCreateStudent(this RouteGroupBuilder group)
    {
        group.MapPost("", async (
                CreateStudentRequest request,
                CreateStudentHandler handler,
                ClaimsPrincipal principal,
                CancellationToken cancellationToken) =>
            {
                var actorId = Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var parsed)
                    ? parsed
                    : Guid.Empty;
                if (actorId == Guid.Empty) throw AppException.Unauthorized();

                var created = await handler.HandleAsync(request, actorId, cancellationToken);
                return Results.Created($"/api/v1/students/{created.Id}", created);
            })
            .RequireAuthorization("students.create")
            .Produces<StudentResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity)
            .WithName("CreateStudent")
            .WithTags("secretariat");

        return group;
    }
}