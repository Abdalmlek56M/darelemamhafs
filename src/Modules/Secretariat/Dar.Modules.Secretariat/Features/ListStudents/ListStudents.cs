using System.Security.Claims;
using Dar.Common.Domain;
using Dar.Common.Permissions;
using Npgsql;
using Dar.Modules.Secretariat.Abstractions;
using Dar.Modules.Secretariat.Domain;

namespace Dar.Modules.Secretariat.Features.ListStudents;

public sealed record ListStudentsQuery(string? Search, string? Status, int Page, int PageSize);

public sealed class ListStudentsHandler(IStudentRepository repository)
{
    public async Task<PagedResult<StudentResponse>> HandleAsync(
        ListStudentsQuery query,
        bool allScopes,
        Guid[] scopeCircles,
        CancellationToken cancellationToken)
    {
        var result = await repository.ListAsync(
            query.Search,
            query.Status,
            query.Page,
            query.PageSize,
            allScopes,
            scopeCircles,
            cancellationToken);

        var items = result.Items.Select(StudentResponse.From).ToArray();
        return new PagedResult<StudentResponse>(items, result.Page, result.PageSize, result.Total);
    }
}

public static class ListStudentsEndpoint
{
    public static RouteGroupBuilder MapListStudents(this RouteGroupBuilder group)
    {
        group.MapGet("", async (
                string? search,
                string? status,
                int? page,
                int? pageSize,
                ClaimsPrincipal principal,
                NpgsqlDataSource dataSource,
                ListStudentsHandler handler,
                CancellationToken cancellationToken) =>
            {
                await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
                var scope = await ScopeLoader.LoadAsync(connection, principal, cancellationToken);
                var result = await handler.HandleAsync(
                    new ListStudentsQuery(search, status, page ?? 1, pageSize ?? 25),
                    scope.All,
                    scope.CircleIds,
                    cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization("students.read")
            .Produces<PagedResult<StudentResponse>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .WithName("ListStudents")
            .WithTags("secretariat");

        return group;
    }
}
