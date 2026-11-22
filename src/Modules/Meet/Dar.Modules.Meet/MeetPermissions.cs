namespace Dar.Modules.Meet;

/// <summary>
/// Permission codes owned by the recording module. They are mirrored in
/// Dar.Common PermissionCodes (policy registration) and in the legacy catalog so
/// the admin screen can grant/revoke them. Keep the three lists identical.
/// </summary>
public static class MeetPermissions
{
    public const string View = "meet.view";
    public const string Manage = "meet.manage";
    public const string CalendarManage = "meet.calendar.manage";
    public const string MediaView = "meet.media.view";
    public const string MediaDelete = "meet.media.delete";

    public static readonly (string Code, string NameAr)[] All =
    [
        (View, "عرض التسجيل والمحاضرات"),
        (Manage, "إدارة التسجيل وربط الحلقات"),
        (CalendarManage, "ربط ومزامنة تقويم Google"),
        (MediaView, "مشاهدة تسجيلات الحلقات"),
        (MediaDelete, "حذف ملفات التسجيل يدويًا")
    ];
}
