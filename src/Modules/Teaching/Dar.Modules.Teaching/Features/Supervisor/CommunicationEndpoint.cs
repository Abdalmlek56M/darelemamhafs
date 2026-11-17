using System.Security.Claims;
using Npgsql;

namespace Dar.Modules.Teaching.Features.Supervisor;

public sealed record WhatsAppRequest(string RecipientType, Guid RecipientId, string TemplateKey);

public static class CommunicationEndpoint
{
    public static async Task<IResult> WhatsApp(
        WhatsAppRequest request,
        ClaimsPrincipal principal,
        NpgsqlDataSource dataSource,
        CancellationToken ct)
    {
        if (request.RecipientType is not ("teacher" or "student_guardian"))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["recipientType"] = ["نوع المستلم غير صحيح."] });

        var template = (request.TemplateKey ?? "followup").Trim().ToLowerInvariant();
        if (template is not ("absence" or "unpaid" or "teacher_followup" or "student_followup"))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["templateKey"] = ["قالب الرسالة غير صحيح."] });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var scope = await SupervisionScope.LoadAsync(connection, principal, ct);

        string name, phone;
        if (request.RecipientType == "teacher")
        {
            await using var command = new NpgsqlCommand("""
                SELECT full_name, phone FROM teachers
                WHERE id = @id AND is_trashed = FALSE;
                """, connection);
            command.Parameters.AddWithValue("id", request.RecipientId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
                return Results.NotFound(new { message = "المعلمة غير موجودة." });
            name = reader.GetString(0);
            phone = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
            if (!scope.AllowsTeacher(request.RecipientId))
                return Results.Json(new { message = "المعلمة خارج نطاقك." }, statusCode: StatusCodes.Status403Forbidden);
        }
        else
        {
            await using var command = new NpgsqlCommand("""
                SELECT s.full_name, s.guardian_phone, c.id, c.teacher_id
                FROM students s
                JOIN circle_enrollments ce ON ce.student_id = s.id AND ce.is_trashed = FALSE
                JOIN circles c ON c.id = ce.circle_id AND c.is_trashed = FALSE
                WHERE s.id = @id AND s.is_trashed = FALSE
                ORDER BY ce.starts_on DESC
                LIMIT 1;
                """, connection);
            command.Parameters.AddWithValue("id", request.RecipientId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
                return Results.NotFound(new { message = "الطالبة غير موجودة." });
            name = reader.GetString(0);
            phone = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
            var circleId = reader.GetGuid(2);
            var teacherId = reader.IsDBNull(3) ? Guid.Empty : reader.GetGuid(3);
            if (!scope.AllowsCircle(circleId) || (teacherId != Guid.Empty && !scope.AllowsTeacher(teacherId)))
                return Results.Json(new { message = "الطالبة خارج نطاقك." }, statusCode: StatusCodes.Status403Forbidden);
        }

        var normalized = NormalizePhone(phone);
        if (normalized is null)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["phone"] = ["رقم الهاتف غير صالح."] });

        var message = template switch
        {
            "absence" => $"مرحبًا، نود متابعة غياب {name} عن الحلقة.",
            "unpaid" => $"مرحبًا، نود التذكير بمتابعة اشتراك {name}.",
            "teacher_followup" => $"مرحبًا {name}، نود متابعة خطة الحلقة.",
            _ => $"مرحبًا، نود متابعة {name} مع دار الإمام حفص."
        };
        var href = $"https://wa.me/{normalized}?text={Uri.EscapeDataString(message)}";

        await using (var log = new NpgsqlCommand("""
            INSERT INTO communication_log(actor_user_id, recipient_type, recipient_id, phone, template_key)
            VALUES (@actor, @type, @recipient, @phone, @template);
            """, connection))
        {
            log.Parameters.AddWithValue("actor", TeachingPrincipal.UserId(principal));
            log.Parameters.AddWithValue("type", request.RecipientType);
            log.Parameters.AddWithValue("recipient", request.RecipientId);
            log.Parameters.AddWithValue("phone", normalized);
            log.Parameters.AddWithValue("template", template);
            await log.ExecuteNonQueryAsync(ct);
        }

        return Results.Ok(new { href, phone = normalized });
    }

    private static string? NormalizePhone(string value)
    {
        var digits = new string(value.Where(char.IsDigit).ToArray());
        if (digits.StartsWith("00", StringComparison.Ordinal)) digits = digits[2..];
        if (digits.StartsWith('0')) digits = $"20{digits[1..]}";
        return digits.Length is < 8 or > 15 ? null : digits;
    }
}
