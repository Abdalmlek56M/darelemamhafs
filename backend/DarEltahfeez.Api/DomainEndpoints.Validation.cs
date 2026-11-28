using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class DomainEndpoints
{
    private static Dictionary<string,string[]>? ValidateStudent(StudentWriteRequest r)
    {
        var e=new Dictionary<string,string[]>();if(string.IsNullOrWhiteSpace(r.FullName)||r.FullName.Trim().Length>180)e["fullName"]=["اسم الطالب مطلوب وبحد أقصى 180 حرفًا."];
        if(r.StudentCode?.Trim().Length>40)e["studentCode"]=["كود الطالب يجب ألا يتجاوز 40 حرفًا."];
        if(r.AgeYears is <0 or >120)e["ageYears"]=["العمر يجب أن يكون بين صفر و120 سنة."];
        if(HasInvalidPhoneChars(r.Phone))e["phone"]=["رقم الهاتف يجب أن يحتوي أرقامًا فقط مع الرموز + - ( ) والمسافات، بحد أقصى 40 حرفًا."];
        if(HasInvalidPhoneChars(r.GuardianPhone))e["guardianPhone"]=["هاتف ولي الأمر يجب أن يحتوي أرقامًا فقط مع الرموز + - ( ) والمسافات، بحد أقصى 40 حرفًا."];
        if(r.GuardianName?.Trim().Length>180)e["guardianName"]=["اسم ولي الأمر طويل جدًا."];
        if(r.Notes?.Length>10000)e["notes"]=["الملاحظات طويلة جدًا."];
        string[] statuses=["active","paused","withdrawn","archived"];if(!statuses.Contains(r.Status,StringComparer.Ordinal))e["status"]=["اختر حالة صحيحة للطالب."];
        if(r.JoinedOn==default)e["joinedOn"]=["تاريخ الالتحاق غير صحيح."];
        if(IsInvalidGender(r.Gender))e["gender"]=["اختر جنسًا صحيحًا."];
        if(IsInvalidGender(r.GuardianGender))e["guardianGender"]=["اختر جنس ولي الأمر بشكل صحيح."];
        return e.Count==0?null:e;
    }
    private static Dictionary<string,string[]>? ValidateTeacher(TeacherWriteRequest r)
    {
        var e=new Dictionary<string,string[]>();if(string.IsNullOrWhiteSpace(r.FullName)||r.FullName.Trim().Length>180)e["fullName"]=["اسم المعلمة مطلوب وبحد أقصى 180 حرفًا."];
        if(r.TeacherCode?.Trim().Length>40)e["teacherCode"]=["كود المعلمة طويل جدًا."];
        if(r.HourlyRate is < 0)e["hourlyRate"]=["أجر الساعة لا يمكن أن يكون سالبًا."];
        if(HasInvalidPhoneChars(r.Phone))e["phone"]=["رقم الهاتف يجب أن يحتوي أرقامًا فقط مع الرموز + - ( ) والمسافات، بحد أقصى 40 حرفًا."];
        if(!new[]{"active","inactive","archived"}.Contains(r.Status,StringComparer.Ordinal))e["status"]=["حالة المعلمة غير صحيحة."];
        if(IsInvalidGender(r.Gender))e["gender"]=["اختر جنسًا صحيحًا."];
        return e.Count==0?null:e;
    }
    private static Dictionary<string,string[]>? ValidateCircle(CircleWriteRequest r)
    {
        var e=new Dictionary<string,string[]>();if(string.IsNullOrWhiteSpace(r.Name)||r.Name.Trim().Length>160)e["name"]=["اسم الحلقة مطلوب وبحد أقصى 160 حرفًا."];
        if(r.CircleCode?.Trim().Length>40)e["circleCode"]=["كود الحلقة طويل جدًا."];
        if(r.MonthlyFee is < 0)e["monthlyFee"]=["الرسوم لا يمكن أن تكون سالبة."];
        if(r.ScheduleText?.Length>300)e["scheduleText"]=["وصف المواعيد يجب ألا يتجاوز 300 حرف."];
        if(r.StartsOn==default)e["startsOn"]=["حدد تاريخ بدء الحلقة الفعلي."];
        if(!new[]{"individual","group"}.Contains(NormalizeCircleType(r.CircleType),StringComparer.Ordinal))e["circleType"]=["اختر نوع الحلقة (فردية أو جماعية)."];
        return e.Count==0?null:e;
    }

    private static bool IsInvalidGender(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        var normalized = value.Trim().ToLowerInvariant();
        return normalized is not ("male" or "female");
    }

    private static string? NormalizeGender(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim().ToLowerInvariant();

    private static string NormalizeCircleType(string? value)
        => string.IsNullOrWhiteSpace(value) ? "group" : value.Trim().ToLowerInvariant();

    private static bool HasInvalidPhoneChars(string? value)
    {
        var trimmed = value?.Trim() ?? string.Empty;
        return trimmed.Length > 40 || trimmed.Any(ch => !(char.IsAsciiDigit(ch) || ch is '+' or ' ' or '-' or '(' or ')'));
    }

    private static void AddStudentParams(NpgsqlCommand cmd,StudentWriteRequest r,string code)
    {
        cmd.Parameters.AddWithValue("code",code);cmd.Parameters.AddWithValue("name",r.FullName.Trim());cmd.Parameters.AddWithValue("age",r.AgeYears is null?(object)DBNull.Value:r.AgeYears.Value);
        AddNullable(cmd,"phone",r.Phone);AddNullable(cmd,"guardian",r.GuardianName);AddNullable(cmd,"guardianPhone",r.GuardianPhone);
        cmd.Parameters.AddWithValue("joined",r.JoinedOn);cmd.Parameters.AddWithValue("status",r.Status);AddNullable(cmd,"notes",r.Notes);
        AddNullable(cmd,"gender",NormalizeGender(r.Gender));AddNullable(cmd,"guardianGender",NormalizeGender(r.GuardianGender));
    }
    private static void AddNullable(NpgsqlCommand cmd,string name,string? value)=>cmd.Parameters.AddWithValue(name,string.IsNullOrWhiteSpace(value)?DBNull.Value:value.Trim());
    private static void AddNullableGuid(NpgsqlCommand cmd, string name, Guid? value)
    {
        // Keep nullable UUID parameters typed even when Value is DBNull. Parameters used
        // only inside jsonb_build_object have no target-column type for PostgreSQL to infer.
        var parameter = cmd.Parameters.Add(name, NpgsqlDbType.Uuid);
        parameter.Value = value.HasValue ? (object)value.Value : DBNull.Value;
    }
    private static string NewCode(string prefix)=>$"{prefix}-{DateTime.UtcNow:yyyyMMddHHmmssfff}-{Random.Shared.Next(10,99)}";
    private static bool CanReadFinance(ClaimsPrincipal principal) => principal.HasClaim("permission", "finance.read");
    private static bool CanEditFinancialValues(ClaimsPrincipal principal) => CanReadFinance(principal) && principal.HasClaim("permission", "finance.edit");
    private static Guid ActorId(ClaimsPrincipal user)=>Guid.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier),out var id)?id:Guid.Empty;
    private static Dictionary<string,string[]>? ValidateScheduleDrafts(IReadOnlyList<ScheduleSlotDraft>? drafts, bool circleIsActive, Guid? teacherId, string fieldName = "slots")
    {
        if (drafts is null || drafts.Count == 0) return null;
        var errors = new Dictionary<string,string[]>();
        if (drafts.Count > 20) errors[fieldName] = ["لا يمكن حفظ أكثر من 20 موعدًا أسبوعيًا للحلقة الواحدة."];
        if (!circleIsActive || teacherId is null || teacherId == Guid.Empty)
            errors[fieldName] = ["لإضافة مواعيد فعلية، فعّل الحلقة وحدّد المعلمة المسؤولة أولًا."];
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var draft in drafts)
        {
            if (draft.DayOfWeek is < 0 or > 6 || draft.DurationMinutes is < 15 or > 360 ||
                !TryParseScheduleSlotTime(draft.StartsAt, out var startsAt))
            {
                errors[fieldName] = ["مواعيد الحلقة غير صحيحة: اختَر يومًا صحيحًا، ووقتًا بصيغة HH:mm، ومدة من 15 إلى 360 دقيقة."];
                continue;
            }
            if (!seen.Add(draft.DayOfWeek + "|" + startsAt.ToString("HH:mm")))
                errors[fieldName] = ["توجد مواعيد مكررة داخل طلب الحفظ نفسه (نفس اليوم والوقت)."];
        }
        return errors.Count == 0 ? null : errors;
    }

    private static bool TryParseScheduleSlotTime(string? value, out TimeOnly time) =>
        TimeOnly.TryParseExact((value ?? string.Empty).Trim(), "HH:mm", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out time);

    private static bool TryMonth(string? input,out DateOnly month)
    {
        month=default;if(string.IsNullOrWhiteSpace(input)||!DateOnly.TryParseExact(input+"-01","yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.None,out var parsed))return false;
        month=parsed;return true;
    }
}