namespace Dar.Common.Domain;

/// <summary>
/// Stable permission codes shared by the API and the UI.
/// Names are shown only in Arabic admin screens.
/// </summary>
public static class PermissionCodes
{
    public static readonly (string Code, string NameAr)[] All =
    [
        ("dashboard.read", "عرض لوحة التحكم"),
        ("students.read", "عرض الطالبات وسجلاتهن"),
        ("students.create", "إضافة الطالبات"),
        ("students.edit", "تعديل الطالبات وملاحظاتهن وحلقاتهن"),
        ("students.delete", "أرشفة الطالبات"),
        ("teachers.read", "عرض المعلمات"),
        ("teachers.create", "إضافة المعلمات"),
        ("teachers.edit", "تعديل المعلمات وأجر الساعة"),
        ("teachers.delete", "أرشفة المعلمات"),
        ("circles.read", "عرض الحلقات"),
        ("circles.create", "إنشاء الحلقات"),
        ("circles.edit", "تعديل الحلقات والالتحاقات"),
        ("circles.delete", "أرشفة الحلقات"),
        ("schedule.read", "عرض جدول الحلقات"),
        ("schedule.edit", "إدارة مواعيد الحلقات"),
        ("attendance.read", "عرض سجلات الحضور"),
        ("attendance.edit", "تسجيل وتعديل الحضور"),
        ("finance.read", "عرض الاشتراكات والتحصيلات والمالية"),
        ("finance.create", "تسجيل الاستحقاقات والمدفوعات"),
        ("finance.edit", "تعديل الاستحقاقات"),
        ("finance.delete", "إلغاء الحركات المالية"),
        ("users.manage", "إدارة الحسابات والصلاحيات"),
        ("settings.manage", "إدارة إعدادات الدار"),
        ("audit.read", "عرض سجل التدقيق"),
        ("audit.restore", "استرجاع القيم الوصفية"),
        ("trash.manage", "إدارة سلة المهملات"),
        ("backup.manage", "إدارة النسخ الاحتياطية"),
        ("exports.manage", "تصدير البيانات والتقارير")
    ];

    public static bool IsKnown(string? code) =>
        code is not null && All.Any(x => string.Equals(x.Code, code, StringComparison.Ordinal));
}
