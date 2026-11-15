using Dapper;
using Dar.Common.Domain;
using Dar.Modules.Secretariat.Abstractions;
using Dar.Modules.Secretariat.Domain;
using Npgsql;

namespace Dar.Modules.Secretariat.Persistence;

public sealed class StudentRepository(NpgsqlDataSource dataSource) : IStudentRepository
{
    private const string Select = """
        SELECT id AS Id,
               student_code AS StudentCode,
               full_name AS FullName,
               age_years AS AgeYears,
               phone AS Phone,
               guardian_name AS GuardianName,
               guardian_phone AS GuardianPhone,
               joined_on AS JoinedOn,
               status AS Status,
               notes AS Notes,
               created_at AS CreatedAt,
               updated_at AS UpdatedAt
        FROM students
        """;

    public async Task<PagedResult<Student>> ListAsync(
        string? search,
        string? status,
        int page,
        int pageSize,
        CancellationToken ct)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var offset = (page - 1) * pageSize;
        var normalizedSearch = string.IsNullOrWhiteSpace(search) ? null : search.Trim();
        var normalizedStatus = string.IsNullOrWhiteSpace(status) ? null : status.Trim();

        var filter = "WHERE is_trashed=FALSE";
        var parameters = new DynamicParameters();
        parameters.Add("pageSize", pageSize);
        parameters.Add("offset", offset);

        if (normalizedStatus is not null)
        {
            filter += " AND status=@status";
            parameters.Add("status", normalizedStatus);
        }

        if (normalizedSearch is not null)
        {
            filter += """
                 AND (
                     full_name ILIKE @search
                     OR student_code ILIKE @search
                     OR phone ILIKE @search
                     OR guardian_name ILIKE @search
                     OR guardian_phone ILIKE @search
                 )
                """;
            parameters.Add("search", $"%{normalizedSearch}%");
        }

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var total = await connection.ExecuteScalarAsync<long>(
            "SELECT COUNT(*) FROM students " + filter,
            parameters);

        var items = (await connection.QueryAsync<Student>(
            Select + " " + filter + " ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'withdrawn' THEN 2 ELSE 3 END, full_name LIMIT @pageSize OFFSET @offset;",
            parameters)).AsList();

        return new PagedResult<Student>(items, page, pageSize, total);
    }

    public async Task<Student?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        return await connection.QuerySingleOrDefaultAsync<Student>(
            Select + " WHERE id=@id AND is_trashed=FALSE;", new { id });
    }

    public async Task<bool> CodeExistsAsync(string code, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        return await connection.ExecuteScalarAsync<bool>(
            "SELECT EXISTS(SELECT 1 FROM students WHERE student_code=@code);", new { code });
    }

    public async Task<Student> CreateAsync(Student student, Guid actorId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        var row = await connection.QuerySingleAsync<Student>("""
            INSERT INTO students(student_code,full_name,age_years,phone,guardian_name,guardian_phone,joined_on,status,notes)
            VALUES(@StudentCode,@FullName,@AgeYears,@Phone,@GuardianName,@GuardianPhone,@JoinedOn,@Status,@Notes)
            RETURNING id AS Id, created_at AS CreatedAt, updated_at AS UpdatedAt;
            """, student, transaction);

        student.Id = row.Id;
        student.CreatedAt = row.CreatedAt;
        student.UpdatedAt = row.UpdatedAt;

        await connection.ExecuteAsync("""
            INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details,request_path,http_method,can_restore)
            VALUES(@actorId,'student.create','student',@id,
                   jsonb_build_object('studentCode',@studentCode,'fullName',@fullName),
                   '/api/v1/students','POST',FALSE);
            """, new { actorId, id = student.Id, studentCode = student.StudentCode, fullName = student.FullName }, transaction);

        await transaction.CommitAsync(ct);
        return student;
    }
}
