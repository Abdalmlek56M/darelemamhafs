using System.Security.Claims;
using Dar.Common.Domain;
using Dar.Common.Permissions;
using Dar.Modules.Secretariat.Abstractions;
using Dar.Modules.Secretariat.Domain;

namespace Dar.Modules.Secretariat.Features.GetStudent;

public sealed class GetStudentHandler(IStudentRepository repository)
{
    // Tier 2.7: the access scope is resolved by the same statement that reads the student, so a
    // scoped supervisor detail request is one DB round trip instead of ScopeLoader + detail.
    public async Task<StudentResponse> HandleAsync(Guid id, bool allScopes, Guid? userId, CancellationToken cancellationToken)
    {
        var student = await repository.GetByIdAsync(id, allScopes, userId, cancellationToken)
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
                ClaimsPrincipal principal,
                GetStudentHandler handler,
                CancellationToken cancellationToken) =>
            {
                var student = await handler.HandleAsync(
                    id, ScopeLoader.IsAllScope(principal), ScopeLoader.UserId(principal), cancellationToken);
                return Results.Ok(student);
            })
            .RequireAuthorization("students.read")
            .Produces<StudentResponse>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .WithName("GetStudent")
            .WithTags("secretariat");

        return group;
    }
}
