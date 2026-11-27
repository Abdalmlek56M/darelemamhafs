using Dapper;
using Dar.Common.Domain;
using Dar.Common.Search;
using Dar.Modules.Secretariat.Abstractions;
using Dar.Modules.Secretariat.Domain;
using Npgsql;

namespace Dar.Modules.Secretariat.Persistence;

public sealed class StudentRepository(NpgsqlDataSource dataSource) : IStudentRepository
{
    private const string SelectColumns = """
        id AS Id,
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
        """;

    private const string Select = "SELECT " + SelectColumns + " FROM students";
    // Tier 2.7: one round trip for the page AND its total. COUNT(*) OVER() is computed from the
    // same filtered scan, so the total can no longer disagree with a separately counted snapshot.
    private const string SelectWithTotal = "SELECT " + SelectColumns + ", COUNT(*) OVER() AS Total FROM students";

    // Tier 2.7: scope resolution inlined into the list/detail statement. It reproduces
    // ScopeLoader's expansion exactly:
    //   * users.manage => all scopes (allScopes=true short-circuits);
    //   * an account with no app_user_scopes rows keeps the historical fail-open AllScope;
    //   * otherwise a student is visible when one live enrolment points at a circle that is
    //     either a direct circle scope or a circle owned by a direct teacher scope.
    // A missing/invalid principal id with allScopes=false matches nothing (old empty-scope result).
    // students.id IN (subquery) is uncorrelated, so the planner hashes the allowed-student set
    // once instead of running a correlated SubPlan per student row.
    private const string ScopeFilter = """
         AND (@allScopes OR (@userId IS NOT NULL AND (
              NOT EXISTS (SELECT 1 FROM app_user_scopes WHERE user_id=@userId)
              OR students.id IN (
                  SELECT ce.student_id
                  FROM circle_enrollments ce
                  JOIN circles scope_circle ON scope_circle.id=ce.circle_id AND scope_circle.is_trashed=FALSE
                  WHERE ce.is_trashed=FALSE
                    AND (ce.circle_id IN (SELECT scope_id FROM app_user_scopes WHERE user_id=@userId AND scope_type='circle')
                         OR scope_circle.teacher_id IN (SELECT scope_id FROM app_user_scopes WHERE user_id=@userId AND scope_type<>'circle'))))))
        """;

    public async Task<PagedResult<Student>> ListAsync(
        string? search,
        string? status,
        int page,
        int pageSize,
        bool allScopes,
        Guid? userId,
        CancellationToken ct)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var offset = (page - 1) * pageSize;
        var normalizedSearch = string.IsNullOrWhiteSpace(search) ? null : search.Trim();
        var normalizedStatus = string.IsNullOrWhiteSpace(status) ? null : status.Trim();

        var filter = "WHERE is_trashed=FALSE" + ScopeFilter;
        var parameters = new DynamicParameters();
        parameters.Add("pageSize", pageSize);
        parameters.Add("offset", offset);
        parameters.Add("allScopes", allScopes);
        parameters.Add("userId", userId);

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
            // FINAL 2.2: escape LIKE wildcards; "%" or "_" must match literally.
            parameters.Add("search", SqlSearchPattern.Contains(normalizedSearch));
        }

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var rows = (await connection.QueryAsync<Student, long, StudentWithTotal>(
            SelectWithTotal + " " + filter + " ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'withdrawn' THEN 2 ELSE 3 END, full_name, id LIMIT @pageSize OFFSET @offset;",
            (student, total) => new StudentWithTotal(student, total),
            parameters,
            splitOn: "Total")).AsList();

        var total = rows.Count > 0 ? rows[0].Total : 0L;
        if (rows.Count == 0 && offset > 0)
        {
            // An out-of-range page returns no rows, so the window total is unavailable; only this
            // rare request keeps an extra COUNT so the reported total stays exact.
            total = await connection.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM students " + filter, parameters);
        }
        return new PagedResult<Student>(rows.Select(row => row.Student).ToList(), page, pageSize, total);
    }

    public async Task<Student?> GetByIdAsync(Guid id, bool allScopes, Guid? userId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        return await connection.QuerySingleOrDefaultAsync<Student>(
            Select + " WHERE id=@id AND is_trashed=FALSE" + ScopeFilter + ";",
            new { id, allScopes, userId });
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

    private sealed record StudentWithTotal(Student Student, long Total);
}
