using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using DarEltahfeez.Api.Services;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class SystemAdminEndpoints
{
    private static async Task InsertAuditAsync(NpgsqlConnection conn, NpgsqlTransaction tx, Guid? actor, string actorName, string action, string entityType, Guid entityId, string? before, string? after, string path, string method, bool canRestore, CancellationToken ct)
    {
        await AuditLogWriter.WriteAsync(conn, tx, actor, actorName, action, entityType, entityId,
            beforeJson: before, afterJson: after, requestPath: path, httpMethod: method, canRestore: canRestore,
            cancellationToken: ct);
    }

    private static bool CanReadFinance(ClaimsPrincipal principal) => principal.HasClaim("permission", "finance.read");
    private static bool CanEditFinancialValues(ClaimsPrincipal principal) => CanReadFinance(principal) && principal.HasClaim("permission", "finance.edit");

    /// <summary>
    /// Trash is a shared tool, but moving/restoring/purging a record must still require
    /// the same domain permission that owns the record. Otherwise a trash manager could
    /// hide financial history without finance.delete.
    /// </summary>
    private static string? RequiredTrashPermission(string entityType) => entityType switch
    {
        "student" => "students.delete",
        "student-note" => "students.edit",
        "teacher" => "teachers.delete",
        "teacher-note" => "teachers.edit",
        "circle" => "circles.delete",
        "enrollment" => "circles.edit",
        "schedule-slot" => "schedule.edit",
        "teacher-attendance" or "student-attendance" => "attendance.edit",
        "monthly-charge" or "payment" or "collection-report" or "advertising-expense" or "operating-expense" => "finance.delete",
        _ => null
    };

    private static bool CanManageTrashEntity(ClaimsPrincipal principal, string entityType)
    {
        var permission = RequiredTrashPermission(entityType);
        return permission is null || principal.HasClaim("permission", permission);
    }

    private static readonly HashSet<string> FinancialJsonFields = new(StringComparer.OrdinalIgnoreCase)
    {
        "amount", "amountdue", "amountpaid", "paidamount", "balance", "hourlyrate", "hourlyratesnapshot",
        "payableamount", "payabletotal", "monthlyfee", "agreedmonthlyfee", "currentmonthdue", "currentmonthpaid",
        "currentmonthpaymentstatus", "paymentstatus", "paymentmethod", "dailycost", "totalamount", "monthamount", "totaldue", "totalpaid", "totalbalance",
        "expenseamount", "advertisingcost", "teacherpay", "teacherpayable", "rate", "fee", "cost",
        "receiptdata", "receiptfilename", "receiptcontenttype", "receiptuploadedat"
    };

    private static bool ContainsFinancialJsonFields(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return false;
        using var document = JsonDocument.Parse(json);
        return ContainsFinancialJsonFields(document.RootElement);
    }

    private static bool ContainsFinancialJsonFields(JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in value.EnumerateObject())
                {
                    var normalizedName = property.Name.Replace("_", string.Empty, StringComparison.Ordinal).Replace("-", string.Empty, StringComparison.Ordinal);
                    if (FinancialJsonFields.Contains(normalizedName) || ContainsFinancialJsonFields(property.Value)) return true;
                }
                return false;
            case JsonValueKind.Array:
                return value.EnumerateArray().Any(item => ContainsFinancialJsonFields(item));
            default:
                return false;
        }
    }

    private static JsonElement? ParseJsonForFinance(string? json, bool financeVisible)
    {
        if (financeVisible || string.IsNullOrWhiteSpace(json)) return ParseJson(json);
        using var source = JsonDocument.Parse(json);
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer)) WriteJsonWithoutFinancialFields(source.RootElement, writer);
        using var redacted = JsonDocument.Parse(buffer.ToArray());
        return redacted.RootElement.Clone();
    }

    private static void WriteJsonWithoutFinancialFields(JsonElement value, Utf8JsonWriter writer)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in value.EnumerateObject())
                {
                    writer.WritePropertyName(property.Name);
                    var normalizedName = property.Name.Replace("_", string.Empty, StringComparison.Ordinal).Replace("-", string.Empty, StringComparison.Ordinal);
                    if (FinancialJsonFields.Contains(normalizedName)) writer.WriteNullValue();
                    else WriteJsonWithoutFinancialFields(property.Value, writer);
                }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in value.EnumerateArray()) WriteJsonWithoutFinancialFields(item, writer);
                writer.WriteEndArray();
                break;
            default:
                value.WriteTo(writer);
                break;
        }
    }

    private static JsonElement? ParseJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        using var doc = JsonDocument.Parse(json); return doc.RootElement.Clone();
    }
    private static string GetFinanceSafeTrashDisplayName(string entityType) => entityType switch
    {
        "student" => "طالب",
        "teacher" => "معلمة",
        "circle" => "حلقة",
        "student-note" => "ملاحظة طالب",
        "teacher-note" => "ملاحظة معلمة",
        "enrollment" => "التحاق",
        "monthly-charge" => "استحقاق شهري",
        "payment" => "حركة تحصيل",
        "schedule-slot" => "موعد حلقة",
        "teacher-attendance" => "حضور معلمة",
        "student-attendance" => "حضور طالب",
        "advertising-expense" => "مصروف إعلان",
        "operating-expense" => "مصروف تشغيلي",
        _ => "سجل"
    };

    private static string GetDisplayName(string json, string table)
    {
        if (table == "operating_expenses") return "مصروف تشغيلي";
        if (table == "advertising_expenses") return "إعلان";
        if (table == "payments") return "حركة تحصيل";
        if (table == "monthly_charges") return "استحقاق شهري";
        using var doc = JsonDocument.Parse(json); var root = doc.RootElement;
        foreach (var key in new[] { "full_name", "name", "description", "title", "student_code", "teacher_code", "circle_code", "note_text" })
            if (root.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString())) return value.GetString()!;
        return DisplayNames.GetValueOrDefault(table, table);
    }
    private static bool IsSafeHttpsUrl(string? value) => string.IsNullOrWhiteSpace(value) || (Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && uri.Host.Length > 0);
    private static object DbGuid(Guid? value) => value is Guid guid ? guid : DBNull.Value;
    private static object NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? DBNull.Value : value.Trim();
    internal static Guid? ActorId(ClaimsPrincipal principal) => Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;
}
