using Dar.Common.Domain;
using Dar.Modules.Secretariat.Domain;

namespace Dar.Modules.Secretariat.Abstractions;

public interface IStudentRepository
{
    // Tier 2.7: the access scope is resolved inside the same statement (one round trip) instead of
    // a separate ScopeLoader command before every list/detail request. userId is the principal's
    // user id; allScopes is true for users.manage holders. NULL userId + allScopes=false matches
    // nothing, exactly like the previous empty-scope behavior.
    Task<PagedResult<Student>> ListAsync(
        string? search,
        string? status,
        int page,
        int pageSize,
        bool allScopes,
        Guid? userId,
        CancellationToken ct);

    Task<Student?> GetByIdAsync(Guid id, bool allScopes, Guid? userId, CancellationToken ct);
    Task<bool> CodeExistsAsync(string code, CancellationToken ct);
    Task<Student> CreateAsync(Student student, Guid actorId, CancellationToken ct);
}
