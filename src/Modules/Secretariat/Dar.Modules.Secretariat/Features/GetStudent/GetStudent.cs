using Dar.Common.Domain;
using Dar.Modules.Secretariat.Abstractions;
using Dar.Modules.Secretariat.Domain;

namespace Dar.Modules.Secretariat.Features.GetStudent;

public sealed class GetStudentHandler(IStudentRepository repository)
{
    public async Task<StudentResponse> HandleAsync(Guid id, CancellationToken cancellationToken)
    {
        var student = await repository.GetByIdAsync(id, cancellationToken)
                      ?? throw AppException.NotFound("الطالبة غير موجودة.");
        return StudentResponse.From(student);
    }
}

public static class GetStudentEndpoint
{
    public static RouteGroupBuilder MapGetStudent(this RouteGroupBuilder group)
    {
        group.MapGet("/{id:guid}", async (
                Guid id,
                GetStudentHandler handler,
                CancellationToken cancellationToken) =>
            {
                var student = await handler.HandleAsync(id, cancellationToken);
                return Results.Ok(student);
            })
            .RequireAuthorization("students.read")
            .WithName("GetStudent")
            .WithTags("secretariat");

        return group;
    }
}
