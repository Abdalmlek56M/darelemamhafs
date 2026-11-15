// User-visible permission groups; identifiers remain stable in the API/database.
export const permissionGroups: { label: string; codes: string[] }[] = [
  { label: 'لوحة التحكم', codes: ['dashboard.read'] },
  { label: 'الطلاب', codes: ['students.read', 'students.create', 'students.edit', 'students.delete'] },
  { label: 'المعلمات', codes: ['teachers.read', 'teachers.create', 'teachers.edit', 'teachers.delete'] },
  { label: 'الحلقات', codes: ['circles.read', 'circles.create', 'circles.edit', 'circles.delete'] },
  { label: 'جدول الحلقات', codes: ['schedule.read', 'schedule.edit'] },
  { label: 'حضور المعلمات والطلاب وأجور المعلمات', codes: ['attendance.read', 'attendance.edit'] },
  { label: 'الاشتراكات والتحصيل والمالية', codes: ['finance.read', 'finance.create', 'finance.edit', 'finance.delete'] },
  { label: 'إدارة النظام', codes: ['users.manage', 'settings.manage', 'audit.read', 'audit.restore', 'trash.manage', 'backup.manage', 'exports.manage'] },
]
export const knownPermissionNames: Record<string, string> = {
  'dashboard.read': 'عرض لوحة التحكم', 'students.read': 'عرض الطلاب وسجلاتهم', 'students.create': 'إضافة الطلاب', 'students.edit': 'تعديل الطلاب وملاحظاتهم وحلقاتهم', 'students.delete': 'حذف الطلاب وسجلاتهم',
  'teachers.read': 'عرض المعلمات', 'teachers.create': 'إضافة المعلمات', 'teachers.edit': 'تعديل المعلمات وأجر الساعة', 'teachers.delete': 'حذف المعلمات غير المرتبطة بحلقات',
  'circles.read': 'عرض الحلقات', 'circles.create': 'إنشاء الحلقات', 'circles.edit': 'تعديل الحلقات والالتحاقات', 'circles.delete': 'حذف الحلقات الفارغة', 'schedule.read': 'عرض جدول الحلقات', 'schedule.edit': 'إنشاء وتعديل مواعيد الحلقات', 'attendance.read': 'عرض سجلات حضور المعلمات والطلاب ومستحقات المعلمات', 'attendance.edit': 'تسجيل وتعديل حضور المعلمات والطلاب',
  'finance.read': 'عرض الاشتراكات والتحصيلات والمالية', 'finance.create': 'إضافة الاستحقاقات والمدفوعات وحفظ التقارير', 'finance.edit': 'تعديل الاستحقاقات', 'finance.delete': 'حذف المدفوعات والتقارير', 'users.manage': 'إدارة الحسابات والصلاحيات', 'settings.manage': 'إدارة إعدادات الدار', 'audit.read': 'عرض سجل التغييرات', 'audit.restore': 'استرجاع نسخ البيانات السابقة', 'trash.manage': 'إدارة سلة المهملات والاستعادة والحذف النهائي', 'backup.manage': 'إنشاء وتنزيل النسخ الاحتياطية', 'exports.manage': 'تصدير بيانات الدار',
}
