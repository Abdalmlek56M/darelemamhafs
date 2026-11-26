using System.Security.Claims;
using Dar.Common.Domain;
using Dar.Common.Permissions;
using Npgsql;
using Dar.Modules.Secretariat.Abstractions;
using Dar.Modules.Secretariat.Domain;

namespace Dar.Modules.Secretariat.Features.GetStudent;

public sealed class GetStudentHandler(IStudentRepository repository)
{
    public async Task<StudentResponse> HandleAsync(Guid id, bool allScopes, Guid[] scopeCircles, CancellationToken cancellationToken)
    {
        var student = await repository.GetByIdAsync(id, allScopes, scopeCircles, cancellationToken)
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
                NpgsqlDataSource dataSource,
                GetStudentHandler handler,
                CancellationToken cancellationToken) =>
            {
                await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
                var scope = await ScopeLoader.LoadAsync(connection, principal, cancellationToken);
                var student = await handler.HandleAsync(id, scope.All, scope.CircleIds, cancellationToken);
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
