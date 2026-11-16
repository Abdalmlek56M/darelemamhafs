import type { Branding } from '../domain/types'
import { DatabaseZap, FileArchive, FileText, History, Settings2, Trash2 } from 'lucide-react'
import type { AdminSettings, ResetCandidates, ResetType } from './types'

export type SystemTab = 'settings' | 'audit' | 'trash' | 'backups' | 'export' | 'reset'

export const emptyResetCandidates: ResetCandidates = {
  teacherAttendance: [],
  studentAttendance: [],
  scheduleSlots: [],
  monthlyCharges: [],
  payments: [],
  advertisingExpenses: [],
  operatingExpenses: [],
  generalOperatingExpenses: [],
  collectionReports: [],
}

export const resetTypeLabels: Record<ResetType, string> = {
  all: 'كل بيانات التشغيل',
  student: 'الطلاب',
  teacher: 'المعلمات',
  circle: 'الحلقات',
  'teacher-attendance': 'سجلات حضور المعلمات',
  'student-attendance': 'سجلات حضور الطلاب',
  'schedule-slot': 'مواعيد الحلقات',
  'monthly-charge': 'الاستحقاقات الشهرية',
  payment: 'عمليات التحصيل',
  'advertising-expense': 'مصروفات الإعلانات',
  'operating-expense': 'المصروفات التشغيلية',
  'collection-report': 'تقارير التحصيل',
}

export const scopeOptions = [
  { id: 'all', label: 'كل الأقسام والبيانات' },
  { id: 'students', label: 'الطلاب وملاحظاتهم والتحاقاتهم والمدفوعات التابعة' },
  { id: 'teachers', label: 'المعلمات وسجلات حضورهن' },
  { id: 'circles', label: 'الحلقات والجدول والالتحاقات والتكاليف المرتبطة' },
  { id: 'finance', label: 'الاستحقاقات والتحصيل والإعلانات والمصروفات والتقارير' },
  { id: 'schedule', label: 'المواعيد وحضور المعلمات' },
  { id: 'admin', label: 'الحسابات والصلاحيات وسجل التدقيق وإعدادات النظام' },
]

export const systemTabs: { id: SystemTab; label: string; icon: typeof Settings2; permission: string }[] = [
  { id: 'settings', label: 'هوية الدار', icon: Settings2, permission: 'settings.manage' },
  { id: 'audit', label: 'سجل التغييرات', icon: History, permission: 'audit.read' },
  { id: 'trash', label: 'سلة المهملات', icon: Trash2, permission: 'trash.manage' },
  { id: 'backups', label: 'النسخ الاحتياطية', icon: FileArchive, permission: 'backup.manage' },
  { id: 'export', label: 'تصدير البيانات', icon: FileText, permission: 'exports.manage' },
  { id: 'reset', label: 'تصفير بيانات التشغيل', icon: DatabaseZap, permission: 'trash.manage' },
]

/** Mirrors the server-side trash permission map. */
export function trashPermissionFor(entityType: string): string | null {
  switch (entityType) {
    case 'student': return 'students.delete'
    case 'student-note': return 'students.edit'
    case 'teacher': return 'teachers.delete'
    case 'teacher-note': return 'teachers.edit'
    case 'circle': return 'circles.delete'
    case 'enrollment': return 'circles.edit'
    case 'schedule-slot': return 'schedule.edit'
    case 'teacher-attendance':
    case 'student-attendance': return 'attendance.edit'
    case 'monthly-charge':
    case 'payment':
    case 'collection-report':
    case 'advertising-expense':
    case 'operating-expense': return 'finance.delete'
    default: return null
  }
}

export const defaultSettings = (value: Branding): AdminSettings => ({
  ...value,
  facebookUrl: value.facebookUrl ?? '',
  tiktokUrl: value.tiktokUrl ?? '',
  whatsappUrl: value.whatsappUrl ?? '',
  trashRetentionDays: 30,
})
