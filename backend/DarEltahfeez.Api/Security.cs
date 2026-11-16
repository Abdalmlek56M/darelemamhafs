using System.Security.Cryptography;
using System.Text;

namespace DarEltahfeez.Api;

public static class AppPermissions
{
    public static readonly (string Code, string NameAr)[] All =
    [
        ("dashboard.read", "عرض لوحة التحكم"),
        ("students.read", "عرض الطلاب وسجلاتهم"),
        ("students.create", "إضافة الطلاب"),
        ("students.edit", "تعديل الطلاب وملاحظاتهم وحلقاتهم"),
        ("students.delete", "حذف الطلاب وسجلاتهم"),
        ("teachers.read", "عرض المعلمات"),
        ("teachers.create", "إضافة المعلمات"),
        ("teachers.edit", "تعديل المعلمات وأجر الساعة"),
        ("teachers.delete", "حذف المعلمات غير المرتبطة بحلقات"),
        ("circles.read", "عرض الحلقات"),
        ("circles.create", "إنشاء الحلقات"),
        ("circles.edit", "تعديل الحلقات والالتحاقات"),
        ("circles.delete", "حذف الحلقات الفارغة"),
        ("schedule.read", "عرض جدول الحلقات"),
        ("schedule.edit", "إدارة مواعيد الحلقات"),
        ("attendance.read", "عرض سجلات حضور المعلمات والطلاب"),
        ("attendance.edit", "تسجيل وتعديل حضور المعلمات والطلاب"),
        ("finance.read", "عرض الاشتراكات والتحصيلات والمالية"),
        ("finance.create", "تسجيل الاستحقاقات والمدفوعات وحفظ تقارير التحصيل"),
        ("finance.edit", "تعديل الاستحقاقات"),
        ("finance.delete", "حذف حركات التحصيل وتقاريرها"),
        ("users.manage", "إدارة الحسابات والصلاحيات"),
        ("settings.manage", "إدارة إعدادات الدار"),
        ("audit.read", "عرض سجل التدقيق والتغييرات"),
        ("audit.restore", "استرجاع نسخة سابقة من تعديل"),
        ("trash.manage", "إدارة سلة المهملات والاستعادة والحذف النهائي"),
        ("backup.manage", "إنشاء وتنزيل النسخ الاحتياطية وإدارتها"),
        ("exports.manage", "تصدير بيانات الدار وتقارير PDF"),
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
        ("supervisor.teachers.read", "متابعة المعلمات")
    ];

    public static bool IsKnown(string? code) => All.Any(x => x.Code == code);
}

public static class Passwords
{
    private const int Iterations = 210_000;
    private const int SaltSize = 16;
    private const int HashSize = 32;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, HashSize);
        return $"pbkdf2-sha256${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string stored)
    {
        try
        {
            var parts = stored.Split('$');
            if (parts.Length != 4 || parts[0] != "pbkdf2-sha256" || !int.TryParse(parts[1], out var iterations)) return false;
            if (iterations < 100_000 || iterations > 2_000_000) return false;
            var salt = Convert.FromBase64String(parts[2]);
            var expected = Convert.FromBase64String(parts[3]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException) { return false; }
    }
}
