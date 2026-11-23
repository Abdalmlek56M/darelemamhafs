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
        ("finance.void", "إلغاء السجلات المالية بسبب موثق"),
        ("users.manage", "إدارة الحسابات والصلاحيات"),
        ("settings.manage", "إدارة إعدادات الدار"),
        ("audit.read", "عرض سجل التدقيق"),
        ("audit.restore", "استرجاع القيم الوصفية"),
        ("trash.manage", "إدارة سلة المهملات"),
        ("backup.manage", "إدارة النسخ الاحتياطية"),
        ("exports.manage", "تصدير البيانات والتقارير"),
        ("teacher.portal", "الدخول إلى بوابة المعلمة"),
        ("teacher.attendance", "تسجيل حضور حلقتها وطالباتها"),
        ("teacher.earnings.self", "عرض مستحقاتها فقط"),
        ("teacher.students.read", "عرض طالباتها فقط"),
        ("teacher.subscriptions.read", "عرض حالة اشتراكات طالباتها"),
        ("teacher.notes.write", "إضافة ملاحظات الحلقة والطالبة"),
        ("supervisor.portal", "الدخول إلى بوابة المشرفة"),
        ("supervisor.live", "عرض الحلقات المباشرة"),
        ("supervisor.absences", "عرض ومتابعة الغياب"),
        ("supervisor.unpaid", "عرض المتأخرات والمتابعة"),
        ("supervisor.attendance.correct", "تصحيح الحضور والوقت والأجر"),
        ("supervisor.teachers.read", "متابعة المعلمات"),
        ("account.password.self", "تغيير كلمة المرور من الحساب"),
        ("supervisor.students.read", "عرض الطلاب في النطاق"),
        ("supervisor.students.create", "إضافة طلاب في النطاق"),
        ("supervisor.students.edit", "تعديل طلاب في النطاق"),
        ("supervisor.students.delete", "أرشفة طلاب في النطاق"),
        ("supervisor.students.notes", "إضافة ملاحظات الطلاب"),
        ("supervisor.circles.read", "عرض الحلقات في النطاق"),
        ("supervisor.circles.create", "إضافة حلقات في النطاق"),
        ("supervisor.circles.edit", "تعديل حلقات في النطاق"),
        ("supervisor.circles.delete", "أرشفة حلقات في النطاق"),
        ("supervisor.teachers.notes", "إضافة ملاحظات المعلمات"),
        ("supervisor.attendance.requests", "مراجعة طلبات الغياب والتصحيح"),
        ("supervisor.communication", "استخدام قوالب واتساب"),
        ("supervisor.reports", "تقارير الإشراف"),
        ("teacher.calendar", "تقويم المعلمة الأسبوعي"),
        ("teacher.history.self", "سجل حلقات المعلمة السابقة"),
        ("teacher.requests", "تقديم طلبات الغياب والتصحيح"),
        ("reports.finance", "الأقسام المالية في التقارير"),
        ("meet.view", "عرض التسجيل والمحاضرات"),
        ("meet.manage", "إدارة التسجيل وربط الحلقات"),
        ("meet.calendar.manage", "ربط ومزامنة تقويم Google"),
        ("meet.media.view", "مشاهدة تسجيلات الحلقات"),
        ("meet.media.delete", "حذف ملفات التسجيل يدويًا"),
        ("meet.bot.control", "التحكم في بوت التسجيل")
    ];

    public static bool IsKnown(string? code) =>
        code is not null && All.Any(x => string.Equals(x.Code, code, StringComparison.Ordinal));
}