using System.Security.Claims;
using Dar.Common.Domain;
using Dar.Common.Permissions;
using Dar.Modules.Secretariat.Abstractions;
using Dar.Modules.Secretariat.Domain;

namespace Dar.Modules.Secretariat.Features.ListStudents;

public sealed record ListStudentsQuery(string? Search, string? Status, int Page, int PageSize);

public sealed class ListStudentsHandler(IStudentRepository repository)
{
    /// <summary>
    /// Tier 2.7: the access scope is resolved inside the same statement as the page + total, so a
    /// scoped supervisor list request is one DB round trip instead of ScopeLoader + COUNT + page.
    /// </summary>
    public async Task<PagedResult<StudentResponse>> HandleAsync(
        ListStudentsQuery query,
        bool allScopes,
        Guid? userId,
        CancellationToken cancellationToken)
    {
        var result = await repository.ListAsync(
            query.Search,
            query.Status,
            query.Page,
            query.PageSize,
            allScopes,
            userId,
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
                ListStudentsHandler handler,
                CancellationToken cancellationToken) =>
            {
                var result = await handler.HandleAsync(
                    new ListStudentsQuery(search, status, page ?? 1, pageSize ?? 25),
                    ScopeLoader.IsAllScope(principal),
                    ScopeLoader.UserId(principal),
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
