using System.Collections.Generic;
using System.IO;
using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dar.Common.Pagination;
using DarEltahfeez.Api.Services;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class SystemAdminEndpoints
{
    private static readonly IReadOnlyDictionary<string, string> DisplayNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["students"] = "الطلاب", ["student_notes"] = "ملاحظات الطلاب", ["teacher_notes"] = "ملاحظات المعلمات", ["circle_enrollments"] = "التحاقات الحلقات",
        ["monthly_charges"] = "الاستحقاقات", ["payments"] = "التحصيلات", ["teachers"] = "المعلمات", ["circles"] = "الحلقات",
        ["circle_schedule_slots"] = "مواعيد الحلقات", ["teacher_attendance"] = "حضور المعلمات", ["student_attendance"] = "حضور الطلاب", ["advertising_expenses"] = "الإعلانات",
        ["operating_expenses"] = "المصروفات التشغيلية", ["collection_reports"] = "تقارير التحصيل", ["school_settings"] = "إعدادات الدار",
        ["app_users"] = "الحسابات", ["user_permissions"] = "صلاحيات الحسابات", ["audit_log"] = "سجل التدقيق", ["trash_items"] = "سلة المهملات", ["system_backups"] = "سجل النسخ الاحتياطية"
    };

    public static void Map(WebApplication app)
    {
        MapBrandingAndProfile(app);
        MapAuditAndTrash(app);
        MapBackupsAndExport(app);
        MapMediaMaintenance(app);
    }

    private sealed record BrandingResponse(string BrandName, string? LogoDataUrl, string? FacebookUrl, string? TiktokUrl, string? WhatsappUrl);
    private sealed record AdminSettingsResponse(string BrandName, string? LogoDataUrl, string FacebookUrl, string TiktokUrl, string WhatsappUrl, int TrashRetentionDays, DateTimeOffset UpdatedAt, string WhatsappTemplateAbsence, string WhatsappTemplateUnpaid, string WhatsappTemplateTeacherFollowup, string WhatsappTemplateStudentFollowup, string TeacherNotesBanner, bool TeacherNotesBannerActive);
    private sealed record AdminSettingsWriteRequest(string BrandName, string? LogoDataUrl, bool ClearLogo, string? FacebookUrl, string? TiktokUrl, string? WhatsappUrl, int TrashRetentionDays, string? WhatsappTemplateAbsence = null, string? WhatsappTemplateUnpaid = null, string? WhatsappTemplateTeacherFollowup = null, string? WhatsappTemplateStudentFollowup = null, string? TeacherNotesBanner = null, bool? TeacherNotesBannerActive = null);
    private sealed record ProfileAvatarRequest(string DataUrl);
    private sealed record TrashCreateRequest(string? EntityType, Guid EntityId);
    private sealed record BackupCreateRequest(string[]? Scopes);
    private sealed record AdminAuditEventRequest(string ActionCode,string EntityType,Guid? EntityId,JsonElement? Details);
}
