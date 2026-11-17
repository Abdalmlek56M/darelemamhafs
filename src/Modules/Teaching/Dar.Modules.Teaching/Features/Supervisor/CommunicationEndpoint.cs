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
        var settings = await LoadSettingsAsync(connection, ct);

        string name, phone, circleName;
        if (request.RecipientType == "teacher")
        {
            await using var command = new NpgsqlCommand("""
                SELECT t.full_name, t.phone,
                       COALESCE((SELECT c.name FROM circles c
                                 WHERE c.teacher_id = t.id AND c.is_trashed = FALSE
                                 ORDER BY c.is_active DESC, c.name LIMIT 1), '')
                FROM teachers t
                WHERE t.id = @id AND t.is_trashed = FALSE;
                """, connection);
            command.Parameters.AddWithValue("id", request.RecipientId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
                return Results.NotFound(new { message = "المعلمة غير موجودة." });
            name = reader.GetString(0);
            phone = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
            circleName = reader.IsDBNull(2) ? string.Empty : reader.GetString(2);
            if (!scope.AllowsTeacher(request.RecipientId))
                return Results.Json(new { message = "المعلمة خارج نطاقك." }, statusCode: StatusCodes.Status403Forbidden);
        }
        else
        {
            await using var command = new NpgsqlCommand("""
                SELECT s.full_name, s.guardian_phone, c.id, c.teacher_id, c.name
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
            circleName = reader.GetString(4);
            if (!scope.AllowsCircle(circleId) || (teacherId != Guid.Empty && !scope.AllowsTeacher(teacherId)))
                return Results.Json(new { message = "الطالبة خارج نطاقك." }, statusCode: StatusCodes.Status403Forbidden);
        }

        var normalized = NormalizePhone(phone);
        if (normalized is null)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["phone"] = ["رقم الهاتف غير صالح."] });

        var body = settings.Template(template);
        if (string.IsNullOrWhiteSpace(body)) body = DefaultTemplate(template);
        var message = Render(body, name, circleName, settings.BrandName);
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

        return Results.Ok(new { href, phone = normalized, message });
    }

    private static async Task<CommunicationSettings> LoadSettingsAsync(NpgsqlConnection connection, CancellationToken ct)
    {
        await using var command = new NpgsqlCommand("""
            SELECT brand_name, whatsapp_template_absence, whatsapp_template_unpaid,
                   whatsapp_template_teacher_followup, whatsapp_template_student_followup
            FROM school_settings WHERE id = 1;
            """, connection);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return CommunicationSettings.Default;
        return new CommunicationSettings(
            reader.IsDBNull(0) ? "دار الإمام حفص" : reader.GetString(0),
            reader.IsDBNull(1) ? string.Empty : reader.GetString(1),
            reader.IsDBNull(2) ? string.Empty : reader.GetString(2),
            reader.IsDBNull(3) ? string.Empty : reader.GetString(3),
            reader.IsDBNull(4) ? string.Empty : reader.GetString(4));
    }

    private static string DefaultTemplate(string template) => template switch
    {
        "absence" => "مرحبًا، نود متابعة غياب {name} عن {circle}.",
        "unpaid" => "مرحبًا، نود التذكير بمتابعة اشتراك {name} في {circle}.",
        "teacher_followup" => "مرحبًا {name}، نود متابعة خطة الحلقة.",
        _ => "مرحبًا، نود متابعة {name} مع {brand}."
    };

    private static string Render(string body, string name, string circleName, string brand)
    {
        var text = body
            .Replace("{name}", name, StringComparison.Ordinal)
            .Replace("{circle}", string.IsNullOrWhiteSpace(circleName) ? "الحلقة" : circleName, StringComparison.Ordinal)
            .Replace("{brand}", string.IsNullOrWhiteSpace(brand) ? "دار الإمام حفص" : brand, StringComparison.Ordinal)
            .Trim();
        return text.Length > 1500 ? text[..1500] : text;
    }

    private static string? NormalizePhone(string value)
    {
        var digits = new string(value.Where(char.IsDigit).ToArray());
        if (digits.StartsWith("00", StringComparison.Ordinal)) digits = digits[2..];
        if (digits.StartsWith('0')) digits = $"20{digits[1..]}";
        return digits.Length is < 8 or > 15 ? null : digits;
    }

    private sealed record CommunicationSettings(
        string BrandName,
        string Absence,
        string Unpaid,
        string TeacherFollowup,
        string StudentFollowup)
    {
        public static readonly CommunicationSettings Default = new(
            "دار الإمام حفص",
            string.Empty,
            string.Empty,
            string.Empty,
            string.Empty);

        public string Template(string key) => key switch
        {
            "absence" => Absence,
            "unpaid" => Unpaid,
            "teacher_followup" => TeacherFollowup,
            _ => StudentFollowup
        };
    }
}
