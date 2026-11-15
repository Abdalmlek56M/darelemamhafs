using Dar.Common.Domain;
using Dar.Modules.Secretariat.Domain;

namespace Dar.Modules.Secretariat.Abstractions;

public interface IStudentRepository
{
    Task<PagedResult<Student>> ListAsync(
        string? search,
        string? status,
        int page,
        int pageSize,
        CancellationToken ct);

    Task<Student?> GetByIdAsync(Guid id, CancellationToken ct);
    Task<bool> CodeExistsAsync(string code, CancellationToken ct);
    Task<Student> CreateAsync(Student student, Guid actorId, CancellationToken ct);
}
