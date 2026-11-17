using System.Security.Claims;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Supervisor;

public sealed record AddSupervisionNoteRequest(string Text);

public static class SupervisionNotesEndpoint
{
    public static async Task<IResult> AddStudentNote(
        Guid id,
        AddSupervisionNoteRequest request,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var text = (request.Text ?? string.Empty).Trim();
        if (text.Length is < 2 or > 4000)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["text"] = ["اكتب ملاحظة بين حرفين و4000 حرف."] });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);

        await using (var allowed = new NpgsqlCommand("""
            SELECT EXISTS(
                SELECT 1 FROM students s
                WHERE s.id = @id AND s.is_trashed = FALSE
                  AND EXISTS (
                      SELECT 1 FROM circle_enrollments ce
                      JOIN circles c ON c.id = ce.circle_id AND c.is_trashed = FALSE
                      WHERE ce.student_id = s.id AND ce.is_trashed = FALSE
                        AND (@all OR c.id = ANY(@circles))
                  )
            );
            """, connection))
        {
            allowed.Parameters.AddWithValue("id", id);
            allowed.Parameters.AddWithValue("all", scope.All);
            allowed.Parameters.AddWithValue("circles", scope.CircleIds);
            if (!(bool)(await allowed.ExecuteScalarAsync(ct) ?? false))
                return Results.NotFound(new { message = "الطالبة غير موجودة داخل نطاقك." });
        }

        await using var transaction = await connection.BeginTransactionAsync(ct);
        Guid noteId;
        await using (var insert = new NpgsqlCommand("""
            INSERT INTO student_notes(id, student_id, note_text, created_by)
            VALUES (gen_random_uuid(), @student, @text, @user)
            RETURNING id;
            """, connection, transaction))
        {
            insert.Parameters.AddWithValue("student", id);
            insert.Parameters.AddWithValue("text", text);
            insert.Parameters.AddWithValue("user", TeachingPrincipal.UserId(principal));
            noteId = (Guid)(await insert.ExecuteScalarAsync(ct))!;
        }

        await TeachingAudit.WriteAsync(connection, transaction, principal, "supervisor.student.note", "student", id,
            new { noteId, text }, $"/api/v1/supervisor/students/{id}/notes", "POST", ct);
        await transaction.CommitAsync(ct);

        return Results.Created($"/api/v1/supervisor/students/{id}", new { id = noteId, text });
    }

    public static async Task<IResult> AddTeacherNote(
        Guid id,
        AddSupervisionNoteRequest request,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        var text = (request.Text ?? string.Empty).Trim();
        if (text.Length is < 2 or > 4000)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["text"] = ["اكتب ملاحظة بين حرفين و4000 حرف."] });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);
        if (!scope.AllowsTeacher(id))
            return Results.NotFound(new { message = "المعلمة غير موجودة داخل نطاقك." });

        await using (var exists = new NpgsqlCommand("""
            SELECT EXISTS(SELECT 1 FROM teachers WHERE id = @id AND is_trashed = FALSE);
            """, connection))
        {
            exists.Parameters.AddWithValue("id", id);
            if (!(bool)(await exists.ExecuteScalarAsync(ct) ?? false))
                return Results.NotFound(new { message = "المعلمة غير موجودة." });
        }

        await using var transaction = await connection.BeginTransactionAsync(ct);
        Guid noteId;
        await using (var insert = new NpgsqlCommand("""
            INSERT INTO teacher_notes(id, teacher_id, note_text, created_by)
            VALUES (gen_random_uuid(), @teacher, @text, @user)
            RETURNING id;
            """, connection, transaction))
        {
            insert.Parameters.AddWithValue("teacher", id);
            insert.Parameters.AddWithValue("text", text);
            insert.Parameters.AddWithValue("user", TeachingPrincipal.UserId(principal));
            noteId = (Guid)(await insert.ExecuteScalarAsync(ct))!;
        }

        await TeachingAudit.WriteAsync(connection, transaction, principal, "supervisor.teacher.note", "teacher", id,
            new { noteId, text }, $"/api/v1/supervisor/teachers/{id}/notes", "POST", ct);
        await transaction.CommitAsync(ct);

        return Results.Created($"/api/v1/supervisor/teachers/{id}", new { id = noteId, text });
    }
}
