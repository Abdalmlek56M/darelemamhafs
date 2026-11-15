import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Modal from './components/common/Modal'
import type { Branding, Circle, Student, Teacher } from './domain/types'
import ManagementReportBuilder from './components/ManagementReportBuilder'
import {
  ArchiveRestore, CalendarClock, CheckCircle2, Download, ExternalLink, FileArchive, FileJson,
  FileCode2, FileText, History, ImagePlus, Link2, LoaderCircle, RotateCcw, Save, Settings2,
  ShieldCheck, Trash2, Upload, XCircle, DatabaseZap, UsersRound, GraduationCap, BookOpen,
} from 'lucide-react'

type AdminSettings = Branding & { trashRetentionDays: number; updatedAt?: string }
type AuditRecord = { id: number; actorName: string; actionCode: string; entityType: string; entityId: string | null; occurredAt: string; details: unknown; beforeData: unknown; afterData: unknown; canRestore: boolean; restoredAt: string | null }
type TrashRecord = { id: string; entityType: string; entityId: string; displayName: string; deletedByName: string; deletedAt: string; expiresAt: string; purgeError: string | null }
type BackupRecord = { id: string; fileName: string; scopes: string; format: string; status: string; sizeBytes: number | null; startedAt: string; completedAt: string | null; createdByName: string; errorMessage: string | null }
type ResetType = 'all' | 'student' | 'teacher' | 'circle' | 'teacher-attendance' | 'student-attendance' | 'schedule-slot' | 'monthly-charge' | 'payment' | 'advertising-expense' | 'operating-expense' | 'collection-report'
type ResetCandidate = { id: string; label: string }
type ResetCandidates = { teacherAttendance: ResetCandidate[]; studentAttendance: ResetCandidate[]; scheduleSlots: ResetCandidate[]; monthlyCharges: ResetCandidate[]; payments: ResetCandidate[]; advertisingExpenses: ResetCandidate[]; operatingExpenses: ResetCandidate[]; generalOperatingExpenses: ResetCandidate[]; collectionReports: ResetCandidate[] }
const emptyResetCandidates: ResetCandidates = { teacherAttendance: [], studentAttendance: [], scheduleSlots: [], monthlyCharges: [], payments: [], advertisingExpenses: [], operatingExpenses: [], generalOperatingExpenses: [], collectionReports: [] }
const resetTypeLabels: Record<ResetType, string> = {
  all: 'كل بيانات التشغيل', student: 'الطلاب', teacher: 'المعلمات', circle: 'الحلقات',
  'teacher-attendance': 'سجلات حضور المعلمات', 'student-attendance': 'سجلات حضور الطلاب', 'schedule-slot': 'مواعيد الحلقات',
  'monthly-charge': 'الاستحقاقات الشهرية', payment: 'عمليات التحصيل', 'advertising-expense': 'مصروفات الإعلانات',
  'operating-expense': 'المصروفات التشغيلية', 'collection-report': 'تقارير التحصيل'
}
type Props = { permissions: string[]; branding: Branding; onBrandingSaved: (value: Branding) => void; notify: (tone: 'success' | 'error' | 'info', text: string) => void; reportData: { circles: Circle[]; teachers: Teacher[]; students: Student[]; currentMonth: string } }
type Tab = 'settings' | 'audit' | 'trash' | 'backups' | 'export' | 'reset'
const scopeOptions = [
  { id: 'all', label: 'كل الأقسام والبيانات' }, { id: 'students', label: 'الطلاب وملاحظاتهم والتحاقاتهم والمدفوعات التابعة' },
  { id: 'teachers', label: 'المعلمات وسجلات حضورهن' }, { id: 'circles', label: 'الحلقات والجدول والالتحاقات والتكاليف المرتبطة' },
  { id: 'finance', label: 'الاستحقاقات والتحصيل والإعلانات والمصروفات والتقارير' },
  { id: 'schedule', label: 'المواعيد وحضور المعلمات' }, { id: 'admin', label: 'الحسابات والصلاحيات وسجل التدقيق وإعدادات النظام' },
]
const tabs: { id: Tab; label: string; icon: typeof Settings2; permission: string }[] = [
  { id: 'settings', label: 'هوية الدار', icon: Settings2, permission: 'settings.manage' },
  { id: 'audit', label: 'سجل التغييرات', icon: History, permission: 'audit.read' },
  { id: 'trash', label: 'سلة المهملات', icon: Trash2, permission: 'trash.manage' },
  { id: 'backups', label: 'النسخ الاحتياطية', icon: FileArchive, permission: 'backup.manage' },
  { id: 'export', label: 'تصدير البيانات', icon: FileText, permission: 'exports.manage' },
  { id: 'reset', label: 'تصفير بيانات التشغيل', icon: DatabaseZap, permission: 'trash.manage' },
]
const defaultSettings = (value: Branding): AdminSettings => ({ ...value, facebookUrl: value.facebookUrl ?? '', tiktokUrl: value.tiktokUrl ?? '', whatsappUrl: value.whatsappUrl ?? '', trashRetentionDays: 30 })
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!(init.body instanceof FormData) && init.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...init, headers })
  if (!response.ok) {
    let message = `تعذر تنفيذ الطلب (${response.status}).`
    try { const body = await response.json(); message = body.message ?? body.detail ?? body.title ?? Object.values(body.errors ?? {})[0]?.toString() ?? message } catch { /* non-JSON error */ }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
function formatDate(value: string | null | undefined) { if (!value) return '—'; const date = new Date(value); if (Number.isNaN(date.getTime())) return value; return value.includes('T') ? new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(date) }
function bytes(value: number | null) { if (value == null) return '—'; if (value < 1024) return `${value} بايت`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} ك.ب`; return `${(value / 1024 / 1024).toFixed(1)} م.ب` }
function downloadBlob(name: string, blob: Blob) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
function xmlEscape(value: unknown) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;') }
function xmlTagName(key: string) { const name = key.replace(/[^A-Za-z0-9_.-]/g, '_'); return /^[A-Za-z_]/.test(name) ? name : `field_${name}` }
function valueToXml(tag: string, value: unknown): string {
  const safeTag = xmlTagName(tag)
  if (value == null) return `<${safeTag} nil="true"/>`
  if (Array.isArray(value)) return `<${safeTag}>${value.map(item => valueToXml('item', item)).join('')}</${safeTag}>`
  if (typeof value === 'object') return `<${safeTag}>${Object.entries(value as Record<string, unknown>).map(([key, nested]) => valueToXml(key, nested)).join('')}</${safeTag}>`
  return `<${safeTag}>${xmlEscape(value)}</${safeTag}>`
}
function payloadToXml(payload: any): string {
  const sections = Object.entries(payload.sections ?? {}).map(([name, raw]) => {
    const rows = Array.isArray(raw) ? raw : []
    return `<section name="${xmlEscape(name)}">${rows.map((row: unknown) => `<record>${row && typeof row === 'object' ? Object.entries(row as Record<string, unknown>).map(([key, value]) => valueToXml(key, value)).join('') : valueToXml('value', row)}</record>`).join('')}</section>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<darExport><schoolName>${xmlEscape(payload.schoolName)}</schoolName><generatedAt>${xmlEscape(payload.generatedAt)}</generatedAt><scope>${xmlEscape(payload.scope)}</scope><sections>${sections}</sections></darExport>`
}
// Translate internal audit codes and database vocabulary only at the presentation layer.
// PostgreSQL keeps the stable technical identifiers; the administrator sees Arabic labels.
const entityLabels: Record<string, string> = {
  student: 'طالب', students: 'الطلاب', 'student-note': 'ملاحظة طالب', student_notes: 'ملاحظات الطلاب', report: 'تقرير', 'data-reset': 'تصفير بيانات التشغيل', 'data-export': 'تصدير بيانات', system_backup: 'نسخة احتياطية',
  teacher: 'معلمة', teachers: 'المعلمات', circle: 'حلقة', circles: 'الحلقات', enrollment: 'التحاق بحلقة',
  'circle-enrollment': 'التحاق بحلقة', circle_enrollments: 'التحاقات الحلقات', 'monthly-charge': 'استحقاق شهري', monthly_charges: 'الاستحقاقات الشهرية',
  payment: 'عملية تحصيل', payments: 'عمليات التحصيل', 'schedule-slot': 'موعد حلقة', circle_schedule_slot: 'موعد حلقة', circle_schedule_slots: 'مواعيد الحلقات',
  'teacher-attendance': 'حضور معلمة', teacher_attendance: 'حضور المعلمات', 'student-attendance': 'حضور طالب', student_attendance: 'حضور الطلاب', 'advertising-expense': 'مصروف إعلان', advertising_expenses: 'مصروفات الإعلانات',
  'operating-expense': 'مصروف تشغيلي', operating_expenses: 'المصروفات التشغيلية', 'collection-report': 'تقرير تحصيل', collection_reports: 'تقارير التحصيل',
  app_user: 'حساب مستخدم', app_users: 'حسابات المستخدمين', user_permission: 'صلاحية حساب', user_permissions: 'صلاحيات الحسابات',
  school_settings: 'إعدادات الدار', settings: 'إعدادات الدار', audit_log: 'سجل التغييرات', trash_items: 'سلة المهملات', system_backups: 'النسخ الاحتياطية', permission: 'صلاحية',
}
const actionLabels: Record<string, string> = {
  'setup.initial_admin': 'إنشاء حساب المدير الأول', 'schedule.create': 'إضافة موعد حلقة', 'schedule.remove': 'حذف موعد حلقة',
  'student.delete': 'حذف طالب', 'settings.update': 'تعديل إعدادات الدار', 'audit.restore_before': 'استعادة بيانات سابقة',
  'charge.update': 'تعديل استحقاق شهري', 'charge.delete': 'حذف استحقاق شهري', 'payment.create_with_receipt': 'تسجيل تحصيل وإرفاق إيصال',
  'payment.delete': 'حذف عملية تحصيل', 'advertising.delete': 'حذف مصروف إعلان', 'operating_expense.create': 'إضافة مصروف تشغيلي',
  'operating_expense.update': 'تعديل مصروف تشغيلي', 'operating_expense.delete': 'حذف مصروف تشغيلي',
  'trash.restore': 'استعادة سجل من المهملات', 'trash.purge': 'حذف نهائي من المهملات', 'backup.create': 'إنشاء نسخة احتياطية',
  'export.create': 'تصدير بيانات', 'auth.login': 'تسجيل الدخول', 'auth.logout': 'تسجيل الخروج', 'user.create': 'إنشاء حساب', 'user.update': 'تعديل حساب', 'profile.avatar.update': 'تعديل صورة الحساب', 'circle.create': 'إنشاء حلقة', 'circle.update': 'تعديل حلقة', 'teacher.create': 'إضافة معلمة', 'teacher.update': 'تعديل معلمة', 'student.create': 'إضافة طالب', 'student.update': 'تعديل بيانات طالب', 'enrollment.create': 'إلحاق طالب بحلقة', 'enrollment.end': 'إنهاء التحاق طالب', 'attendance.create': 'تسجيل حضور معلمة', 'attendance.update': 'تعديل سجل حضور', 'attendance.duration.update': 'تعديل مدة حضور المعلمة', 'student.attendance.create': 'تسجيل حضور طالب', 'student.attendance.update': 'تعديل حضور طالب', 'report.create': 'إعداد تقرير PDF', 'export.json': 'تصدير بيانات JSON', 'export.xml': 'تصدير بيانات XML', 'data.reset': 'تصفير بيانات التشغيل',
}
const fieldLabels: Record<string, string> = {
  username: 'اسم المستخدم', display_name: 'اسم العرض', displayName: 'اسم العرض', full_name: 'الاسم الكامل', fullName: 'الاسم الكامل',
  name: 'الاسم', student_name: 'اسم الطالب', studentName: 'اسم الطالب', teacher_name: 'اسم المعلمة', teacherName: 'اسم المعلمة',
  student_code: 'كود الطالب', studentCode: 'كود الطالب', teacher_code: 'كود المعلمة', teacherCode: 'كود المعلمة', circle_code: 'كود الحلقة', circleCode: 'كود الحلقة',
  age_years: 'العمر بالسنوات', ageYears: 'العمر بالسنوات', phone: 'رقم الهاتف', guardian_name: 'اسم ولي الأمر', guardianName: 'اسم ولي الأمر', guardian_phone: 'هاتف ولي الأمر', guardianPhone: 'هاتف ولي الأمر',
  joined_on: 'تاريخ الانضمام', joinedOn: 'تاريخ الانضمام', starts_on: 'تاريخ بداية الالتحاق', startsOn: 'تاريخ بداية الالتحاق', ends_on: 'تاريخ نهاية الالتحاق', endsOn: 'تاريخ نهاية الالتحاق',
  status: 'الحالة', is_active: 'الحالة', isActive: 'الحالة', notes: 'ملاحظات', note_text: 'نص الملاحظة', noteText: 'نص الملاحظة',
  circle_name: 'اسم الحلقة', circleName: 'اسم الحلقة', monthly_fee: 'الرسوم الشهرية', monthlyFee: 'الرسوم الشهرية', agreed_monthly_fee: 'الرسوم المتفق عليها', agreedMonthlyFee: 'الرسوم المتفق عليها',
  billing_month: 'شهر الاستحقاق', billingMonth: 'شهر الاستحقاق', amount_due: 'المبلغ المستحق', amountDue: 'المبلغ المستحق', paid_amount: 'المبلغ المدفوع', paidAmount: 'المبلغ المدفوع', balance: 'المبلغ المتبقي', amount: 'المبلغ', payment_status: 'حالة السداد', paymentStatus: 'حالة السداد', total_due: 'إجمالي المستحق', totalDue: 'إجمالي المستحق', total_paid: 'إجمالي المحصل', totalPaid: 'إجمالي المحصل', total_balance: 'إجمالي المتبقي', totalBalance: 'إجمالي المتبقي',
  method: 'طريقة الدفع', reference: 'رقم مرجعي', paid_at: 'تاريخ التحصيل', paidAt: 'تاريخ التحصيل', hourly_rate: 'أجر الساعة', hourlyRate: 'أجر الساعة', duration_minutes: 'مدة الحصة بالدقائق', durationMinutes: 'مدة الحصة بالدقائق',
  session_date: 'تاريخ الحصة', sessionDate: 'تاريخ الحصة', scheduled_start: 'موعد بداية الحصة', scheduledStart: 'موعد بداية الحصة', payable_amount: 'المستحق للمعلمة', payableAmount: 'المستحق للمعلمة', hourly_rate_snapshot: 'أجر الساعة وقت التسجيل', hourlyRateSnapshot: 'أجر الساعة وقت التسجيل',
  platform: 'منصة الإعلان', start_date: 'تاريخ بداية الإعلان', startDate: 'تاريخ بداية الإعلان', days_count: 'عدد أيام الإعلان', daysCount: 'عدد أيام الإعلان', daily_cost: 'تكلفة الإعلان يوميًا', dailyCost: 'تكلفة الإعلان يوميًا', total_amount: 'إجمالي المبلغ', totalAmount: 'إجمالي المبلغ',
  expense_date: 'تاريخ المصروف', expenseDate: 'تاريخ المصروف', category: 'التصنيف', description: 'الوصف', brand_name: 'اسم الدار', brandName: 'اسم الدار', logoChanged: 'تم تغيير الشعار',
  trash_retention_days: 'مدة الاحتفاظ بالمهملات بالأيام', trashRetentionDays: 'مدة الاحتفاظ بالمهملات بالأيام', 
  code: 'الكود', title: 'العنوان', permission_name: 'اسم الصلاحية', permissionName: 'اسم الصلاحية', file_name: 'اسم ملف النسخة', fileName: 'اسم ملف النسخة', format: 'صيغة النسخة', backup_format: 'صيغة النسخة', backupFormat: 'صيغة النسخة', size_bytes: 'حجم الملف', sizeBytes: 'حجم الملف', file_size_bytes: 'حجم الملف', fileSizeBytes: 'حجم الملف', error_message: 'تفاصيل الخطأ', errorMessage: 'تفاصيل الخطأ',
  dayOfWeek: 'يوم الأسبوع', day_of_week: 'يوم الأسبوع', startsAt: 'وقت البداية', starts_at: 'وقت البداية', startAt: 'وقت البداية', start_at: 'وقت البداية', avatarUpdated: 'تم تحديث صورة الحساب', created_at: 'تاريخ الإنشاء', createdAt: 'تاريخ الإنشاء', updated_at: 'آخر تعديل', updatedAt: 'آخر تعديل', occurred_at: 'وقت العملية', occurredAt: 'وقت العملية', deleted_at: 'وقت النقل للمهملات', deletedAt: 'وقت النقل للمهملات', expires_at: 'موعد الحذف النهائي', expiresAt: 'موعد الحذف النهائي', restored_at: 'وقت الاستعادة', restoredAt: 'وقت الاستعادة', marked_at: 'وقت تسجيل الحضور', markedAt: 'وقت تسجيل الحضور', started_at: 'وقت البدء', startedAt: 'وقت البدء', completed_at: 'وقت الاكتمال', completedAt: 'وقت الاكتمال',
  permission_code: 'الصلاحية', permissionCode: 'الصلاحية', role_name: 'الدور', roleName: 'الدور', name_ar: 'الاسم بالعربية', action_code: 'الإجراء', actionCode: 'الإجراء', entity_type: 'نوع السجل', entityType: 'نوع السجل', actor_display_name: 'منفذ العملية', actorName: 'منفذ العملية', can_restore: 'يمكن الاسترجاع', canRestore: 'يمكن الاسترجاع', details: 'تفاصيل العملية', scope_codes: 'نطاق النسخة',
  kind: 'نوع التقرير', month: 'الشهر', audience: 'نوع النسخة', targetLabel: 'السجل أو النطاق', circleCount: 'عدد الحلقات', circle_count: 'عدد الحلقات', teacherCount: 'عدد المعلمات', teacher_count: 'عدد المعلمات', studentCount: 'عدد الطلاب', student_count: 'عدد الطلاب', sessionCount: 'عدد الحصص', session_count: 'عدد الحصص', movedCount: 'عدد السجلات المنقولة', moved_count: 'عدد السجلات المنقولة', failedCount: 'عدد السجلات التي تعذر نقلها', failed_count: 'عدد السجلات التي تعذر نقلها', mode: 'صيغة التصدير', scope: 'نطاق البيانات', generatedAt: 'تاريخ إعداد التقرير', generated_at: 'تاريخ إعداد التقرير', reportType: 'نوع التقرير', report_type: 'نوع التقرير', resetType: 'نطاق التصفير', reset_type: 'نطاق التصفير', recordCount: 'عدد السجلات', record_count: 'عدد السجلات', backupFileName: 'اسم النسخة الاحتياطية', backup_file_name: 'اسم النسخة الاحتياطية',
} 
const hiddenAuditKeys = /(^id$|_id$|Id$|password|token|request.?path|http.?method|backup.?path|logo.?data|receipt.?data|avatar.?data|record.?snapshot|before.?data|after.?data|(^|_)(created|updated|deleted|recorded|marked|saved|actor|user)_by$|^(created|updated|deleted|recorded|marked|saved|actor|user)By$)/i
const entityLabel = (value: string | null | undefined) => value ? (entityLabels[value] ?? 'سجل') : 'غير محدد'
function actionLabel(value: string | null | undefined, entityType?: string) {
  if (!value) return 'عملية مسجلة'
  if (actionLabels[value]) return actionLabels[value]
  const lowerValue = value.toLowerCase()
  if (lowerValue === 'api.patch' || lowerValue === 'api.put') return `تعديل بيانات — ${entityLabel(entityType ?? '')}`
  if (lowerValue === 'api.post') return `تسجيل عملية — ${entityLabel(entityType ?? '')}`
  if (lowerValue === 'api.delete') return `حذف سجل — ${entityLabel(entityType ?? '')}`
  const parts = lowerValue.split(/[._-]+/)
  const verb = parts.find(part => ['create','created','add','added','update','updated','edit','edited','delete','deleted','remove','removed','restore','restored','purge','purged','archive','archived','login','logout','export','backup'].includes(part))
  const operation: Record<string,string> = {create:'إضافة',created:'إضافة',add:'إضافة',added:'إضافة',update:'تعديل',updated:'تعديل',edit:'تعديل',edited:'تعديل',delete:'حذف',deleted:'حذف',remove:'حذف',removed:'حذف',restore:'استعادة',restored:'استعادة',purge:'حذف نهائي',purged:'حذف نهائي',archive:'أرشفة',archived:'أرشفة',login:'تسجيل الدخول',logout:'تسجيل الخروج',export:'تصدير',backup:'نسخ احتياطي'}
  return verb ? `${operation[verb]} — ${entityLabel(entityType ?? parts.find(part => entityLabels[part]) ?? '')}` : 'عملية إدارية'
}
function fieldLabel(key: string): string | null {
  const normalized = key.trim()
  if (fieldLabels[normalized]) return fieldLabels[normalized]
  const lower = normalized.toLowerCase()
  if (fieldLabels[lower]) return fieldLabels[lower]
  return null
}
function auditFieldLabel(key: string, value: unknown): string | null {
  if (key.toLowerCase() === 'method' && typeof value === 'string' && /^(GET|POST|PUT|PATCH|DELETE)$/i.test(value)) return 'طريقة تنفيذ العملية'
  return fieldLabel(key)
}
function displayScopes(value: string) {
  const names: Record<string,string> = {all:'كل البيانات',students:'الطلاب',teachers:'المعلمات',circles:'الحلقات',finance:'المالية والتحصيل',schedule:'المواعيد والحضور',admin:'الحسابات والصلاحيات والإعدادات'}
  return value.split(',').map(x => names[x.trim()] ?? (x.trim() === '' ? '' : 'قسم إضافي')).filter(Boolean).join('، ') || 'كل البيانات'
}
function auditPrimitive(value: unknown) {
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا'
  if (value == null) return 'غير مسجل'
  if (typeof value === 'string') {
    const values: Record<string,string> = {active:'نشط',inactive:'غير نشط',archived:'مؤرشف',paused:'متوقف مؤقتًا',withdrawn:'منسحب',ended:'منتهي',end:'منتهي',closed:'مغلق',deleted:'محذوف',present:'حاضر',absent:'غائب',excused:'غائب بعذر',cancelled:'ملغاة',paid:'مدفوع',partial:'مدفوع جزئيًا',unpaid:'غير مدفوع',cash:'نقدي',transfer:'تحويل بنكي',instapay:'إنستاباي',completed:'مكتمل',failed:'فشل',running:'جارٍ التنفيذ',get:'عرض بيانات',post:'تسجيل إجراء',put:'تعديل بيانات',patch:'تعديل بيانات',delete:'حذف سجل',admin:'مدير النظام',school:'ملخص الدار',circles:'تقارير الحلقات',teacher:'تقرير معلمة','teacher-attendance':'حضور المعلمات','student-attendance':'حضور الطلاب',student:'تقرير طالب',internal:'تقرير إداري',share:'نسخة للمشاركة',json:'JSON',xml:'XML',all:'كل بيانات التشغيل'}
    if (values[value.toLowerCase()]) return values[value.toLowerCase()]
    if (entityLabels[value]) return entityLabels[value]
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return formatDate(value)
  }
  return String(value)
}
const financialAuditKey = /^(monthly_?fee|agreed_?monthly_?fee|amount_?due|paid_?amount|balance|total_?(due|paid|balance|amount)|amount|hourly_?rate(_snapshot)?|payable_?amount|daily_?cost|month_?amount|payment_?amount|total_?amount)$/i
function AuditValue({ value, compare, tone, fieldKey }: { value: unknown; compare?: unknown; tone?: 'before' | 'after'; fieldKey?: string }) {
  const changed = tone !== undefined && JSON.stringify(value) !== JSON.stringify(compare)
  const contentClass = changed ? `audit-diff-value audit-diff-${tone}` : undefined
  if (value == null) return <span className={contentClass}>{fieldKey && financialAuditKey.test(fieldKey) ? 'غير متاح دون صلاحية قراءة المالية' : 'لا توجد بيانات'}</span>
  if (Array.isArray(value)) return value.length ? <ol className={`audit-friendly-list ${changed ? `audit-diff-list audit-diff-${tone}` : ''}`}>{value.map((item, index) => <li key={index}><AuditValue value={item} compare={Array.isArray(compare) ? compare[index] : undefined} tone={tone}/></li>)}</ol> : <span className={contentClass}>لا توجد تفاصيل</span>
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([key, item]) => !hiddenAuditKeys.test(key) && auditFieldLabel(key, item) !== null)
    const compareObject = compare && typeof compare === 'object' && !Array.isArray(compare) ? compare as Record<string, unknown> : {}
    return entries.length ? <dl className="audit-friendly-data">{entries.map(([key, item]) => { const fieldChanged = tone !== undefined && JSON.stringify(item) !== JSON.stringify(compareObject[key]); return <div key={key} className={fieldChanged ? `audit-field-changed audit-field-${tone}` : undefined}><dt>{auditFieldLabel(key, item)}</dt><dd>{(key === 'scope' || key === 'scope_codes') && typeof item === 'string' ? displayScopes(item) : <AuditValue value={item} compare={compareObject[key]} tone={tone} fieldKey={key}/>}</dd></div> })}</dl> : <span className={contentClass}>لا توجد تفاصيل قابلة للعرض</span>
  }
  return <span className={contentClass}>{auditPrimitive(value)}</span>
}
export default function SystemAdminView({ permissions, branding, onBrandingSaved, notify, reportData }: Props) {
  const can = useCallback((permission: string) => permissions.includes(permission), [permissions])
  const visibleTabs = useMemo(() => tabs.filter(tab => can(tab.permission) && (tab.id !== 'reset' || can('backup.manage'))), [can])
  const [tab, setTab] = useState<Tab>(() => tabs.find(t => permissions.includes(t.permission))?.id ?? 'settings')
  const [settings, setSettings] = useState<AdminSettings>(() => defaultSettings(branding))
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [clearLogo, setClearLogo] = useState(false)
  const [auditRows, setAuditRows] = useState<AuditRecord[]>([])
  const [auditMonth, setAuditMonth] = useState(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` })
  const [selectedAudit, setSelectedAudit] = useState<AuditRecord | null>(null)
  const [trashRows, setTrashRows] = useState<TrashRecord[]>([])
  const [selectedTrashIds, setSelectedTrashIds] = useState<Set<string>>(() => new Set())
  const [purgingSelectedTrash, setPurgingSelectedTrash] = useState(false)
  const [backupRows, setBackupRows] = useState<BackupRecord[]>([])
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['all'])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [exportEntityType, setExportEntityType] = useState<'all' | 'student' | 'teacher' | 'circle'>('all')
  const [exportEntityId, setExportEntityId] = useState('')
  const [resetType, setResetType] = useState<ResetType>('all')
  const [resetCandidates, setResetCandidates] = useState<ResetCandidates>(emptyResetCandidates)
  const [resetTargetId, setResetTargetId] = useState('')
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [resetting, setResetting] = useState(false)

  const auditDayGroups = useMemo(() => {
    const keyFor = (value: string) => {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return value.slice(0, 10)
      const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
      const get = (type: string) => parts.find(part => part.type === type)?.value ?? '00'
      return `${get('year')}-${get('month')}-${get('day')}`
    }
    const grouped = new Map<string, AuditRecord[]>()
    for (const row of auditRows) {
      const key = keyFor(row.occurredAt)
      const list = grouped.get(key) ?? []
      list.push(row)
      grouped.set(key, list)
    }
    return Array.from(grouped.entries()).sort((a,b) => b[0].localeCompare(a[0])).map(([key, rows]) => ({
      key,
      label: new Intl.DateTimeFormat('ar-EG', { dateStyle: 'full' }).format(new Date(`${key}T12:00:00`)),
      rows: rows.sort((a,b) => b.occurredAt.localeCompare(a.occurredAt) || b.id-a.id),
    }))
  }, [auditRows])

  useEffect(() => {
    if (!visibleTabs.some(t => t.id === tab)) setTab(visibleTabs[0]?.id ?? 'settings')
  }, [visibleTabs, tab])

  const loadTab = useCallback(async (requested: Tab = tab) => {
    setLoading(true); setRefreshing(true)
    const minimumFeedback = new Promise(resolve => window.setTimeout(resolve, 1000))
    try {
      if (requested === 'settings' && can('settings.manage')) setSettings(await api<AdminSettings>('/api/admin/settings'))
      if (requested === 'audit' && can('audit.read')) setAuditRows(await api<AuditRecord[]>(`/api/admin/audit-log?limit=10000&month=${encodeURIComponent(auditMonth)}`))
      if (requested === 'trash' && can('trash.manage')) setTrashRows(await api<TrashRecord[]>('/api/admin/trash'))
      if (requested === 'backups' && can('backup.manage')) setBackupRows(await api<BackupRecord[]>('/api/admin/backups'))
      if (requested === 'reset' && can('trash.manage') && can('backup.manage')) setResetCandidates(await api<ResetCandidates>('/api/admin/reset-candidates'))
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر تحميل بيانات قسم النظام.') }
    finally { await minimumFeedback; setLoading(false); setRefreshing(false) }
  }, [tab, can, notify, auditMonth])
  useEffect(() => { void loadTab(tab) }, [tab, loadTab])

  const resetTargetOptions: ResetCandidate[] = useMemo(() => {
    if (resetType === 'student') return reportData.students.map(row => ({ id: row.id, label: `${row.fullName} · ${row.studentCode}` }))
    if (resetType === 'teacher') return reportData.teachers.map(row => ({ id: row.id, label: `${row.fullName} · ${row.teacherCode}` }))
    if (resetType === 'circle') return reportData.circles.map(row => ({ id: row.id, label: `${row.name} · ${row.circleCode}` }))
    const keyByType: Partial<Record<ResetType, keyof ResetCandidates>> = {
      'teacher-attendance': 'teacherAttendance', 'student-attendance': 'studentAttendance', 'schedule-slot': 'scheduleSlots',
      'monthly-charge': 'monthlyCharges', payment: 'payments', 'advertising-expense': 'advertisingExpenses',
      'operating-expense': 'operatingExpenses', 'collection-report': 'collectionReports'
    }
    const candidateKey = keyByType[resetType]
    return candidateKey ? resetCandidates[candidateKey] : []
  }, [resetType, reportData.students, reportData.teachers, reportData.circles, resetCandidates])
  useEffect(() => {
    const refreshActiveSystemTab = () => { void loadTab() }
    window.addEventListener('dar:refresh-system', refreshActiveSystemTab)
    return () => window.removeEventListener('dar:refresh-system', refreshActiveSystemTab)
  }, [loadTab])

  const saveSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true)
    try {
      let logoDataUrl = clearLogo ? null : settings.logoDataUrl
      if (logoFile) logoDataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('تعذرت قراءة صورة الشعار.')); reader.onerror = () => reject(new Error('تعذرت قراءة صورة الشعار.')); reader.readAsDataURL(logoFile) })
      const payload = { brandName: settings.brandName.trim(), logoDataUrl, clearLogo, facebookUrl: settings.facebookUrl || null, tiktokUrl: settings.tiktokUrl || null, whatsappUrl: settings.whatsappUrl || null, trashRetentionDays: Number(settings.trashRetentionDays) }
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) })
      const nextBranding: Branding = { brandName: payload.brandName, logoDataUrl, facebookUrl: payload.facebookUrl, tiktokUrl: payload.tiktokUrl, whatsappUrl: payload.whatsappUrl }
      onBrandingSaved(nextBranding); setSettings(s => ({ ...s, ...nextBranding })); setLogoFile(null); setClearLogo(false)
      notify('success', 'تم حفظ هوية الدار وإعدادات الاحتفاظ.')
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر حفظ الإعدادات.') }
    finally { setSaving(false) }
  }

  const toggleScope = (id: string) => setSelectedScopes(old => id === 'all' ? ['all'] : (old.includes(id) ? old.filter(x => x !== id) : [...old.filter(x => x !== 'all'), id]))
  const restoreTrash = async (item: TrashRecord) => {
    if (!window.confirm(`استعادة «${item.displayName}» إلى النظام؟`)) return
    try { await api(`/api/admin/trash/${item.id}/restore`, { method: 'POST' }); await loadTab('trash'); notify('success', 'تمت استعادة السجل.') }
    catch (error) { notify('error', error instanceof Error ? error.message : 'تعذرت استعادة السجل.') }
  }
  const purgeTrash = async (item: TrashRecord) => {
    if (!window.confirm(`حذف «${item.displayName}» نهائيًا؟ لن يمكن استرجاعه بعد هذه الخطوة.`)) return
    try { await api(`/api/admin/trash/${item.id}`, { method: 'DELETE' }); await loadTab('trash'); notify('success', 'تم الحذف النهائي.') }
    catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر الحذف النهائي.') }
  }
  const toggleTrashSelection = (id: string) => setSelectedTrashIds(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const selectAllTrash = (checked: boolean) => setSelectedTrashIds(checked ? new Set(trashRows.map(row => row.id)) : new Set())
  const purgeSelectedTrash = async () => {
    const chosen = trashRows.filter(row => selectedTrashIds.has(row.id))
    if (chosen.length === 0) { notify('info', 'حدد سجلًا واحدًا على الأقل.'); return }
    if (!window.confirm(`سيتم حذف ${chosen.length} سجلًا نهائيًا من سلة المهملات. لن يمكن استعادتها بعد ذلك. قد تُحذف السجلات التابعة مع السجل الرئيسي. هل تريد المتابعة؟`)) return
    const priority: Record<string, number> = {
      'student-note': 1, payment: 2, 'student-attendance': 3, 'teacher-attendance': 4,
      'schedule-slot': 5, 'advertising-expense': 6, 'operating-expense': 6,
      'monthly-charge': 7, enrollment: 8, circle: 9, student: 10, teacher: 10,
    }
    const ordered = [...chosen].sort((a,b) => (priority[a.entityType] ?? 0) - (priority[b.entityType] ?? 0) || a.deletedAt.localeCompare(b.deletedAt))
    let deleted = 0, alreadyRemoved = 0
    const failures: string[] = []
    setPurgingSelectedTrash(true)
    try {
      for (const item of ordered) {
        try { await api(`/api/admin/trash/${item.id}`, { method: 'DELETE' }); deleted++ }
        catch (error) {
          const message = error instanceof Error ? error.message : 'تعذر الحذف النهائي.'
          if (message.includes('(404)')) alreadyRemoved++
          else failures.push(`${item.displayName}: ${message}`)
        }
      }
      setSelectedTrashIds(new Set())
      await loadTab('trash')
      if (failures.length) notify('error', `تم حذف ${deleted} سجلًا، وتجاوز ${alreadyRemoved} سجلات حُذفت مع سجل رئيسي، وتعذر حذف ${failures.length}. أول مشكلة: ${failures[0]}`)
      else notify('success', `تم حذف ${deleted} سجلًا نهائيًا${alreadyRemoved ? `، وتم تجاوز ${alreadyRemoved} سجلات حُذفت ضمن سجلات رئيسية` : ''}.`)
    } finally { setPurgingSelectedTrash(false) }
  }
  const restoreAudit = async (row: AuditRecord) => {
    if (!window.confirm('استرجاع القيم السابقة لهذا التعديل؟ سيتم تسجيل عملية الاسترجاع نفسها في سجل التدقيق.')) return
    try { await api(`/api/admin/audit-log/${row.id}/restore-before`, { method: 'POST' }); setSelectedAudit(null); await loadTab('audit'); notify('success', 'تم استرجاع القيم السابقة وتسجيل العملية.') }
    catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر استرجاع القيم السابقة.') }
  }
  const createBackup = async () => {
    setSaving(true)
    try {
      const backup = await api<{ id: string; fileName: string }>('/api/admin/backups', { method: 'POST', body: JSON.stringify({ scopes: selectedScopes }) })
      await loadTab('backups')
      const link = document.createElement('a'); link.href = `/api/admin/backups/${backup.id}/download`; link.download = backup.fileName; document.body.appendChild(link); link.click(); link.remove()
      notify('success', 'اكتمل إنشاء النسخة الاحتياطية، وبدأ تنزيل الملف.')
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر إنشاء النسخة الاحتياطية. تأكد من اتصال قاعدة البيانات المحلية.') }
    finally { setSaving(false) }
  }
  const exportData = async (mode: 'json' | 'xml') => {
    setLoading(true)
    try {
      let scopeQuery = selectedScopes.includes('all') || selectedScopes.length === 0 ? 'all' : selectedScopes.join(',')
      const params = new URLSearchParams({ scopes: scopeQuery })
      let recordLabel = ''
      if (exportEntityType !== 'all') {
        if (exportEntityType === 'student') scopeQuery = 'students'
        if (exportEntityType === 'teacher') scopeQuery = 'teachers,circles,schedule'
        if (exportEntityType === 'circle') scopeQuery = 'circles'
        params.set('scopes', scopeQuery)
        // Export one record or the whole selected data family; the API scopes its related tables to this family.
        params.set('entityType', exportEntityType)
        if (exportEntityId) params.set('entityId', exportEntityId)
        if (exportEntityId && exportEntityType === 'student') {
          const row = reportData.students.find(item => item.id === exportEntityId)
          recordLabel = row ? `${row.fullName}-${row.studentCode}` : 'طالب'
        } else if (exportEntityId && exportEntityType === 'teacher') {
          const row = reportData.teachers.find(item => item.id === exportEntityId)
          recordLabel = row ? `${row.fullName}-${row.teacherCode}` : 'معلمة'
        } else if (exportEntityId && exportEntityType === 'circle') {
          const row = reportData.circles.find(item => item.id === exportEntityId)
          recordLabel = row ? `${row.name}-${row.circleCode}` : 'حلقة'
        } else {
          recordLabel = ({ student: 'كل-الطلاب', teacher: 'كل-المعلمات', circle: 'كل-الحلقات' } as const)[exportEntityType]
        }
      }
      const payload = await api<any>(`/api/admin/export?${params.toString()}`)
      const date = new Date().toISOString().slice(0,10)
      const safeLabel = (recordLabel || 'البيانات').replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-+|-+$/g,'').slice(0,60)
      const name = `دار-الإمام-حفص-${safeLabel}-${date}.${mode}`
      if (mode === 'json') downloadBlob(name, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }))
      else downloadBlob(name, new Blob([payloadToXml(payload)], { type: 'application/xml;charset=utf-8' }))
      try { await api('/api/admin/audit-events', { method: 'POST', body: JSON.stringify({ actionCode: `export.${mode}`, entityType: exportEntityType === 'all' ? 'data-export' : exportEntityType, entityId: exportEntityId || null, details: { mode, scope: scopeQuery, entityId: exportEntityId || null } }) }) } catch { /* the export itself remains available; server-side data access is still authenticated */ }
      notify('success', `تم تنزيل ملف ${mode.toUpperCase()} للنطاق المحدد.`)
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر تصدير البيانات.') }
    finally { setLoading(false) }
  }

  const runDataReset = async () => {
    if (!can('trash.manage') || !can('backup.manage')) { notify('error', 'يلزم تصريحا سلة المهملات والنسخ الاحتياطي لتنفيذ التصفير الآمن.'); return }
    if (resetConfirmText.trim() !== 'تصفير') { notify('error', 'اكتب كلمة «تصفير» للتأكيد.'); return }
    const selectTargets = () => {
      if (resetType === 'student') return reportData.students.filter(row => !resetTargetId || row.id === resetTargetId).map(row => ({ entityType: 'student', entityId: row.id, label: `${row.fullName} · ${row.studentCode}`, rank: 1 }))
      if (resetType === 'circle') return reportData.circles.filter(row => !resetTargetId || row.id === resetTargetId).map(row => ({ entityType: 'circle', entityId: row.id, label: row.name, rank: 2 }))
      if (resetType === 'teacher') return reportData.teachers.filter(row => !resetTargetId || row.id === resetTargetId).map(row => ({ entityType: 'teacher', entityId: row.id, label: row.fullName, rank: 3 }))
      if (resetType === 'all') return [
        ...reportData.students.map(row => ({ entityType: 'student', entityId: row.id, label: `${row.fullName} · ${row.studentCode}`, rank: 1 })),
        ...reportData.circles.map(row => ({ entityType: 'circle', entityId: row.id, label: row.name, rank: 2 })),
        ...reportData.teachers.map(row => ({ entityType: 'teacher', entityId: row.id, label: row.fullName, rank: 3 })),
      ]
      return resetTargetOptions.filter(row => !resetTargetId || row.id === resetTargetId).map(row => ({ entityType: resetType, entityId: row.id, label: row.label, rank: 0 }))
    }
    let targets = selectTargets()
    if (resetType === 'teacher' && targets.some(target => reportData.circles.some(circle => circle.teacherId === target.entityId))) {
      notify('error', 'لا يمكن تصفير معلمة مرتبطة بحلقة موجودة. انقل الحلقة المرتبطة إلى المهملات أولًا، أو استخدم تصفير بيانات التشغيل بالكامل.'); return
    }
    if (targets.length === 0 && resetType !== 'all') { notify('info', 'لا توجد سجلات مطابقة للاختيار الحالي.'); return }
    setResetting(true)
    try {
      // Create and download a full PostgreSQL backup before moving any live record.
      const backup = await api<{ id: string; fileName: string }>('/api/admin/backups', { method: 'POST', body: JSON.stringify({ scopes: ['all'] }) })
      const backupLink = document.createElement('a'); backupLink.href = `/api/admin/backups/${backup.id}/download`; backupLink.download = backup.fileName; document.body.appendChild(backupLink); backupLink.click(); backupLink.remove()
      if (resetType === 'all') {
        const candidates = await api<{ generalOperatingExpenses: ResetCandidate[]; collectionReports: ResetCandidate[] }>('/api/admin/reset-candidates')
        for (const row of candidates.generalOperatingExpenses) targets.push({ entityType: 'operating-expense', entityId: row.id, label: row.label || 'مصروف عام', rank: 4 })
        for (const row of candidates.collectionReports) targets.push({ entityType: 'collection-report', entityId: row.id, label: row.label || 'تقرير تحصيل', rank: 4 })
      }
      targets = targets.sort((a,b)=>a.rank-b.rank)
      let moved = 0
      const failures: string[] = []
      for (const target of targets) {
        try { await api('/api/admin/trash', { method: 'POST', body: JSON.stringify({ entityType: target.entityType, entityId: target.entityId }) }); moved++ }
        catch (error) { failures.push(`${target.label}: ${error instanceof Error ? error.message : 'تعذر النقل'}`) }
      }
      try { await api('/api/admin/audit-events', { method: 'POST', body: JSON.stringify({ actionCode: 'data.reset', entityType: 'data-reset', entityId: null, details: { resetType, targetId: resetTargetId || null, movedCount: moved, failedCount: failures.length, backupId: backup.id, completedAt: new Date().toISOString() } }) }) } catch { /* individual trash moves are already audited */ }
      setTrashRows(await api<TrashRecord[]>('/api/admin/trash'))
      setShowResetConfirm(false); setResetConfirmText(''); setResetTargetId('')
      if (failures.length) notify('error', `تم نقل ${moved} سجلًا إلى المهملات، وتعذر نقل ${failures.length}. راجع سجل التغييرات والمهملات؛ البيانات المنقولة قابلة للاستعادة.`)
      else notify('success', `تم نقل ${moved} سجلًا إلى سلة المهملات بعد إنشاء نسخة احتياطية كاملة وتنزيلها.`)
      setTab('trash')
    } catch (error) {
      notify('error', error instanceof Error ? `لم يكتمل التصفير، ولم نبدأ نقل السجلات قبل نجاح النسخة الاحتياطية. ${error.message}` : 'تعذر إنشاء النسخة الاحتياطية؛ لم يبدأ التصفير.')
    } finally { setResetting(false) }
  }


  return <section className={`system-admin-page ${refreshing ? 'is-refreshing-lists' : ''}`}>
    <div className="page-toolbar"><div className="toolbar-copy"><h2>النظام والصيانة</h2><p>إعدادات هوية الدار، ومراجعة التغييرات، والاسترجاع، والنسخ الاحتياطي وتصدير البيانات. استخدم زر «تحديث كل القوائم» أعلى الشاشة لتحديث القسم المفتوح.</p></div></div>
    <div className="system-tabs">{visibleTabs.map(item => { const Icon = item.icon; return <button key={item.id} className={`system-tab ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}><Icon size={16}/>{item.label}</button> })}</div>

    {tab === 'settings' && can('settings.manage') && <form className="system-panel glass" onSubmit={saveSettings}>
      <div className="system-panel-heading"><div><span className="eyebrow">الهوية والإعدادات</span><h3>هوية الدار وسلوك النظام</h3><p>التغيير هنا ينعكس على لوحة الإدارة وتقرير التصدير. روابط التواصل اختيارية.</p></div><span className="system-heading-icon"><Settings2 size={20}/></span></div>
      <div className="form-grid"><label className="form-field wide"><span>اسم الدار *</span><input required maxLength={200} value={settings.brandName} onChange={e => setSettings(s => ({ ...s, brandName: e.target.value }))}/></label>
        <div className="form-field wide"><span>شعار الدار</span><div className="brand-upload-row">{settings.logoDataUrl && !clearLogo ? <img className="brand-logo-preview" src={settings.logoDataUrl} alt="معاينة شعار الدار"/> : <div className="brand-logo-placeholder"><ImagePlus size={24}/><small>أضف الشعار</small></div>}<div className="brand-upload-controls"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0] ?? null; if (file && file.size > 2 * 1024 * 1024) { notify('error', 'حجم الشعار يجب ألا يتجاوز 2 ميجابايت.'); e.target.value = ''; return } setLogoFile(file); setClearLogo(false); if (file) { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' && setSettings(s => ({ ...s, logoDataUrl: reader.result as string })); reader.readAsDataURL(file) } }}/><small>PNG أو JPG أو WebP — حد أقصى 2 ميجابايت.</small>{settings.logoDataUrl && <button type="button" className="text-link" onClick={() => { setClearLogo(true); setSettings(s => ({ ...s, logoDataUrl: null })); setLogoFile(null) }}><XCircle size={14}/> إزالة الشعار</button>}</div></div></div>
        <label className="form-field"><span>رابط Facebook</span><input type="url" placeholder="https://facebook.com/..." value={settings.facebookUrl ?? ''} onChange={e => setSettings(s => ({ ...s, facebookUrl: e.target.value }))}/></label>
        <label className="form-field"><span>رابط TikTok</span><input type="url" placeholder="https://www.tiktok.com/@..." value={settings.tiktokUrl ?? ''} onChange={e => setSettings(s => ({ ...s, tiktokUrl: e.target.value }))}/></label>
        <label className="form-field"><span>رابط WhatsApp</span><input type="url" placeholder="https://wa.me/20..." value={settings.whatsappUrl ?? ''} onChange={e => setSettings(s => ({ ...s, whatsappUrl: e.target.value }))}/></label>
        <label className="form-field"><span>الاحتفاظ بسلة المهملات (بالأيام)</span><input type="number" min="1" max="3650" required value={settings.trashRetentionDays} onChange={e => setSettings(s => ({ ...s, trashRetentionDays: Number(e.target.value) }))}/><small>يتم حذف السجلات المنقولة للمهملات تلقائيًا بعد انتهاء المدة، إذا لم تمنع علاقة قاعدة بيانات الحذف.</small></label>
        <div className="form-field wide system-note"><span>النسخ الاحتياطي التلقائي</span><small>تتم إدارة الجدولة المستقلة من Dar System Center عبر Windows Task Scheduler، وتعمل حتى عند إغلاق واجهة التطبيق. افتح مركز النظام ثم تبويب «النسخ المجدول» لضبط الموعد والاحتفاظ وتشغيل نسخة فورية.</small></div>
      </div>
      <div className="system-save-row"><span>آخر حفظ: {settings.updatedAt ? formatDate(settings.updatedAt) : '—'}</span><button type="submit" className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={15}/> : <Save size={15}/>} حفظ الإعدادات</button></div>
    </form>}

    {tab === 'audit' && can('audit.read') && <div className="system-panel glass"><div className="system-panel-heading"><div><span className="eyebrow">Accountability</span><h3>سجل التغييرات</h3><p>اختر الشهر، ثم افتح اليوم المطلوب لرؤية كل العمليات المسجلة فيه.</p></div><span className="system-heading-icon"><History size={20}/></span></div>
      <div className="audit-month-toolbar"><label className="form-field"><span>الشهر</span><input type="month" value={auditMonth} onChange={event => setAuditMonth(event.target.value)} /></label><div className="audit-month-summary"><strong>{new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' }).format(new Date(`${auditMonth}-01T12:00:00`))}</strong><span>{auditRows.length} عملية · {auditDayGroups.length} يومًا به نشاط</span></div></div>
      <div className="audit-month-group"><h4>أيام الشهر</h4>{auditDayGroups.map(day => <details className="audit-day-group" key={day.key}><summary><span>{day.label}</span><strong>{day.rows.length} عملية</strong></summary><div className="table-scroll"><table className="students-table wide-table"><thead><tr><th>الوقت</th><th>بواسطة</th><th>الإجراء</th><th>العنصر</th><th>تفاصيل</th><th>الاسترجاع</th></tr></thead><tbody>{day.rows.map(row => <tr key={row.id}><td>{formatDate(row.occurredAt)}</td><td>{row.actorName || (row.actionCode === 'setup.initial_admin' ? 'تهيئة النظام' : 'حساب غير معروف')}</td><td><strong>{actionLabel(row.actionCode, row.entityType)}</strong></td><td>{entityLabel(row.entityType)}</td><td><button className="secondary-button compact-button" onClick={() => setSelectedAudit(row)}>عرض التفاصيل</button></td><td>{row.canRestore && !row.restoredAt && can('audit.restore') ? <button className="secondary-button compact-button" onClick={() => void restoreAudit(row)}><RotateCcw size={13}/> استعادة البيانات السابقة</button> : row.restoredAt ? <span className="status-pill status-active">تم الاسترجاع</span> : <small className="sub-cell">لا يتوفر استرجاع لهذا الإجراء</small>}</td></tr>)}</tbody></table></div></details>)}{auditDayGroups.length === 0 && <div className="empty-inline">لا توجد عمليات مسجلة في هذا الشهر.</div>}</div>
    </div>}

    {tab === 'trash' && can('trash.manage') && <div className="system-panel glass"><div className="system-panel-heading"><div><span className="eyebrow">Recovery</span><h3>سلة المهملات</h3><p>يمكنك استعادة السجلات أو تحديد مجموعة لحذفها نهائيًا. حذف السجل الرئيسي قد يشمل السجلات التابعة له.</p></div><span className="system-heading-icon"><Trash2 size={20}/></span></div>
      <div className="trash-bulk-toolbar"><label className="trash-select-all"><input type="checkbox" checked={trashRows.length > 0 && trashRows.every(row => selectedTrashIds.has(row.id))} onChange={event => selectAllTrash(event.target.checked)} /><span>تحديد الكل ({trashRows.length})</span></label><div><button type="button" className="secondary-button compact-button" onClick={() => selectAllTrash(false)} disabled={selectedTrashIds.size === 0}>إلغاء التحديد</button><button type="button" className="danger-button reset-danger-button" onClick={() => void purgeSelectedTrash()} disabled={selectedTrashIds.size === 0 || purgingSelectedTrash}>{purgingSelectedTrash ? <LoaderCircle className="spin" size={14}/> : <Trash2 size={14}/>} حذف المحدد نهائيًا ({selectedTrashIds.size})</button></div></div>
      <div className="table-scroll"><table className="students-table wide-table"><thead><tr><th>تحديد</th><th>السجل</th><th>النوع</th><th>نُقل بواسطة</th><th>تاريخ الحذف</th><th>الحذف التلقائي</th><th>الإجراء</th></tr></thead><tbody>{trashRows.map(item => <tr key={item.id}><td><input type="checkbox" checked={selectedTrashIds.has(item.id)} onChange={() => toggleTrashSelection(item.id)} aria-label={`تحديد ${item.displayName}`} /></td><td><strong>{item.displayName}</strong>{item.purgeError && <small className="error-text">تعذر الحذف التلقائي؛ توجد علاقة أو مشكلة تحتاج مراجعة.</small>}</td><td>{entityLabel(item.entityType)}</td><td>{item.deletedByName}</td><td>{formatDate(item.deletedAt)}</td><td>{formatDate(item.expiresAt)}</td><td><div className="row-actions"><button className="secondary-button compact-button" onClick={() => void restoreTrash(item)}><ArchiveRestore size={13}/> استعادة</button><button className="small-icon-button danger-action" title="حذف نهائي" onClick={() => void purgeTrash(item)}><Trash2 size={14}/></button></div></td></tr>)}{trashRows.length === 0 && <tr><td colSpan={7}>سلة المهملات فارغة.</td></tr>}</tbody></table></div>
    </div>}

    {tab === 'backups' && can('backup.manage') && <div className="system-panel glass"><div className="system-panel-heading"><div><span className="eyebrow">Backup & restore</span><h3>النسخ الاحتياطية</h3><p>النسخة الكاملة تشمل مخطط PostgreSQL والبيانات. النسخ الجزئية بيانات فقط وتحتاج مخططًا متوافقًا عند الاستعادة.</p></div><span className="system-heading-icon"><FileArchive size={20}/></span></div>
      <div className="scope-grid">{scopeOptions.map(option => <label key={option.id} className="scope-option"><input type="checkbox" checked={selectedScopes.includes(option.id)} onChange={() => toggleScope(option.id)}/><span>{option.label}</span></label>)}</div>
      <div className="system-save-row"><span><CalendarClock size={15}/> تعرض هذه القائمة النسخ المسجلة عبر الـAPI، بما فيها النسخ اليدوية والتاريخية. النسخ المجدولة المستقلة تُدار من Dar System Center ← النسخ المجدول.</span><button className="primary-button" disabled={saving || selectedScopes.length === 0} onClick={() => void createBackup()}>{saving ? <LoaderCircle className="spin" size={15}/> : <Download size={15}/>} إنشاء وتنزيل نسخة</button></div>
      <div className="table-scroll"><table className="students-table wide-table"><thead><tr><th>الملف</th><th>النطاق</th><th>الحالة</th><th>الحجم</th><th>التاريخ</th><th>تنزيل</th></tr></thead><tbody>{backupRows.map(row => <tr key={row.id}><td><strong>{row.fileName}</strong><small className="sub-cell">{row.createdByName}</small>{row.errorMessage && <small className="error-text">تعذر إنشاء النسخة؛ أعد المحاولة، وإذا تكرر الخطأ راجع سجل النظام.</small>}</td><td>{displayScopes(row.scopes)}</td><td><span className={`status-pill ${row.status === 'completed' ? 'status-active' : row.status === 'failed' ? 'status-archived' : 'pay-unpaid'}`}>{row.status === 'completed' ? 'مكتمل' : row.status === 'failed' ? 'فشل' : 'جارٍ'}</span></td><td>{bytes(row.sizeBytes)}</td><td>{formatDate(row.completedAt ?? row.startedAt)}</td><td>{row.status === 'completed' && <a className="secondary-button compact-button" href={`/api/admin/backups/${row.id}/download`}><Download size={13}/> تنزيل</a>}</td></tr>)}{backupRows.length === 0 && <tr><td colSpan={6}>لا توجد نسخ مسجلة في سجل التطبيق حتى الآن. يمكنك إنشاء نسخة يدوية من هنا أو ضبط النسخ المجدول من Dar System Center.</td></tr>}</tbody></table></div>
    </div>}

    {tab === 'export' && can('exports.manage') && <div className="export-workspace">
      <ManagementReportBuilder schoolName={branding.brandName} currentMonth={reportData.currentMonth} circles={reportData.circles} teachers={reportData.teachers} students={reportData.students} permissions={permissions} notify={notify}/>
      <div className="system-panel glass data-export-panel"><div className="system-panel-heading"><div><span className="eyebrow">نقل وحفظ البيانات</span><h3>تصدير بيانات الدار</h3><p>هذه ملفات بيانات للنقل أو المعالجة، وليست تقريرًا إداريًا للمشاركة. التقرير PDF منفصل بالأعلى، والنسخ الاحتياطي الكامل موجود في تبويب «النسخ الاحتياطية».</p></div><span className="system-heading-icon"><FileCode2 size={20}/></span></div>
        <div className="export-entity-filter"><label className="form-field"><span>نوع البيانات المطلوب تصديرها</span><select value={exportEntityType} onChange={event => {setExportEntityType(event.target.value as typeof exportEntityType);setExportEntityId('')}}><option value="all">الأقسام المحددة بالأسفل</option><option value="student">الطلاب</option><option value="teacher">المعلمات والحضور والحلقات المسندة</option><option value="circle">الحلقات وبياناتها المرتبطة</option></select></label>{exportEntityType!=='all'&&<label className="form-field"><span>{exportEntityType==='student'?'الطالب المطلوب تصديره (اختياري)':exportEntityType==='teacher'?'المعلمة المطلوبة (اختياري)': 'الحلقة المطلوبة (اختياري)'}</span><select value={exportEntityId} onChange={event=>setExportEntityId(event.target.value)}><option value="">{exportEntityType==='student'?'كل الطلاب':exportEntityType==='teacher'?'كل المعلمات':'كل الحلقات'}</option>{exportEntityType==='student' ? reportData.students.map(row=><option key={row.id} value={row.id}>{row.fullName} · {row.studentCode}</option>) : exportEntityType==='teacher' ? reportData.teachers.map(row=><option key={row.id} value={row.id}>{row.fullName} · {row.teacherCode}</option>) : reportData.circles.map(row=><option key={row.id} value={row.id}>{row.name} · {row.circleCode}</option>)}</select></label>}</div>{exportEntityType!=='all'&&<p className="export-selection-help">{exportEntityType==='teacher'?'اختَر معلمة بعينها أو اترك الاختيار على «كل المعلمات». يشمل التصدير ملف المعلمة وحلقاتها ومواعيدها وملاحظاتها وسجلات الحضور المرتبطة، ولا يضم رسوم الطلاب أو مدفوعاتهم الفردية.':exportEntityType==='student'?'اختَر طالبًا بعينه أو صدّر ملفات الطلاب كلها مع الالتحاقات والحضور والبيانات المرتبطة.':'اختَر حلقة بعينها أو صدّر جميع الحلقات مع بياناتها المرتبطة.'}</p>}
        {exportEntityType==='all'&&<div className="scope-grid">{scopeOptions.map(option => <label key={option.id} className="scope-option"><input type="checkbox" checked={selectedScopes.includes(option.id)} onChange={() => toggleScope(option.id)}/><span>{option.label}</span></label>)}</div>}
        <div className="export-actions"><button className="secondary-button" disabled={loading} onClick={() => void exportData('json')}><FileJson size={16}/> تنزيل بيانات JSON</button><button className="primary-button" disabled={loading} onClick={() => void exportData('xml')}><FileCode2 size={16}/> تنزيل بيانات XML</button></div>
        <p className="system-warning"><ShieldCheck size={16}/> ملفات البيانات قد تحتوي معلومات إدارية ومالية؛ احتفظ بها في مكان آمن. لا تُعد هذه الملفات بديلًا عن النسخة الاحتياطية القابلة للاستعادة.</p>
      </div>
    </div>}
    {tab === 'reset' && can('trash.manage') && can('backup.manage') && <div className="system-panel glass reset-data-panel"><div className="system-panel-heading"><div><span className="eyebrow">استعادة آمنة</span><h3>تصفير بيانات التشغيل</h3><p>ينقل السجلات المختارة إلى سلة المهملات، ويسجل كل حركة في سجل التغييرات. لا يمس حسابات المستخدمين أو الصلاحيات أو إعدادات الدار أو سجل التدقيق أو النسخ الاحتياطية.</p></div><span className="system-heading-icon"><DatabaseZap size={20}/></span></div>
      <div className="reset-data-warning"><ShieldCheck size={18}/><div><strong>لا يوجد حذف مباشر في هذه الخطوة</strong><p>قبل التصفير يُنشأ ملف Backup كامل ويبدأ تنزيله. بعد ذلك تنتقل السجلات إلى المهملات ويمكن استعادتها من هناك، ما دامت ضمن مدة الاحتفاظ.</p></div></div>
      <div className="reset-data-controls"><label className="form-field"><span>نطاق التصفير</span><select value={resetType} onChange={event=>{setResetType(event.target.value as ResetType);setResetTargetId('')}}><option value="all">كل بيانات التشغيل</option><optgroup label="البيانات الأساسية"><option value="circle">الحلقات وبياناتها التابعة</option><option value="student">الطلاب وسجلاتهم التابعة</option><option value="teacher">المعلمات</option></optgroup><optgroup label="المواعيد والحضور"><option value="schedule-slot">مواعيد الحلقات</option><option value="teacher-attendance">حضور المعلمات</option><option value="student-attendance">حضور الطلاب</option></optgroup><optgroup label="الماليات"><option value="monthly-charge">الاستحقاقات الشهرية</option><option value="payment">عمليات التحصيل</option><option value="advertising-expense">مصروفات الإعلانات</option><option value="operating-expense">المصروفات التشغيلية</option><option value="collection-report">تقارير التحصيل المحفوظة</option></optgroup></select></label>{resetType!=='all'&&<label className="form-field"><span>سجل محدد (اختياري)</span><select value={resetTargetId} onChange={event=>setResetTargetId(event.target.value)}><option value="">كل {resetTypeLabels[resetType]}</option>{resetTargetOptions.map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</select><small>{resetTargetOptions.length} سجلًا متاحًا في النطاق المختار.</small></label>}</div>
      <p className="muted-text">«كل بيانات التشغيل» تشمل السجلات الأساسية ومواعيدها وحضور المعلمات والطلاب والبيانات المالية التشغيلية. التصفير الجزئي ينقل النطاق المختار فقط، وينقل التبعيات المطلوبة معه عند الحاجة. حسابات المستخدمين والصلاحيات والإعدادات وسجل التغييرات والنسخ الاحتياطية لا يشملها التصفير.</p>
      <div className="system-save-row"><span>لا تتابع إلا إذا كان لديك تصريحا النسخ الاحتياطي وسلة المهملات.</span><button type="button" className="secondary-button reset-review-button" onClick={()=>{setResetConfirmText('');setShowResetConfirm(true)}}><DatabaseZap size={15}/> مراجعة التصفير</button></div>
    </div>}
    <AnimatePresence>{showResetConfirm && <Modal wide title="تأكيد تصفير بيانات التشغيل" subtitle="سيُنشأ Backup كامل أولًا، ثم تُنقل السجلات إلى سلة المهملات." close={()=>{if(!resetting)setShowResetConfirm(false)}}><div className="reset-confirm-body"><p>النطاق المختار: <strong>{resetType==='all'?'كل بيانات التشغيل':resetTargetId?(resetTargetOptions.find(row=>row.id===resetTargetId)?.label??resetTypeLabels[resetType]):`كل ${resetTypeLabels[resetType]}`}</strong></p><p>لا يتم حذف سجل التدقيق أو الحسابات أو إعدادات الدار أو النسخ الاحتياطية. إذا تعذّر إنشاء النسخة الاحتياطية، لن يبدأ نقل السجلات.</p><label className="form-field"><span>اكتب «تصفير» للتأكيد</span><input value={resetConfirmText} onChange={event=>setResetConfirmText(event.target.value)} placeholder="تصفير" autoComplete="off"/></label><div className="modal-actions"><button type="button" className="secondary-button" disabled={resetting} onClick={()=>setShowResetConfirm(false)}>إلغاء</button><button type="button" className="danger-button reset-danger-button" disabled={resetting||resetConfirmText.trim()!=='تصفير'} onClick={()=>void runDataReset()}>{resetting?<LoaderCircle className="spin" size={15}/>:<DatabaseZap size={15}/>} {resetting?'جارٍ النسخ والنقل…':'أنشئ نسخة ثم صفّر'}</button></div></div></Modal>}</AnimatePresence>
    <AnimatePresence>{selectedAudit && <Modal wide title={`تفاصيل العملية · ${actionLabel(selectedAudit.actionCode, selectedAudit.entityType)}`} subtitle={`${selectedAudit.actorName || 'حساب غير معروف'} · ${formatDate(selectedAudit.occurredAt)}`} close={() => setSelectedAudit(null)}>
      <div className="audit-modal-grid"><div className="audit-modal-meta"><div className="audit-meta-item"><span>العنصر</span><strong>{entityLabel(selectedAudit.entityType)}</strong></div><div className="audit-meta-item"><span>وقت العملية</span><strong>{formatDate(selectedAudit.occurredAt)}</strong></div><div className="audit-meta-item"><span>حالة الاسترجاع</span><strong>{selectedAudit.restoredAt ? `تم الاسترجاع في ${formatDate(selectedAudit.restoredAt)}` : selectedAudit.canRestore ? 'الاسترجاع متاح حسب الصلاحيات' : 'لا يتوفر استرجاع لهذه العملية'}</strong></div></div>
        {selectedAudit.details != null && <section className="audit-modal-section"><h3>معلومات العملية</h3><AuditValue value={selectedAudit.details}/></section>}
        {selectedAudit.beforeData != null && <section className="audit-modal-section audit-before-section"><h3>البيانات قبل التعديل</h3><AuditValue value={selectedAudit.beforeData} compare={selectedAudit.afterData} tone="before"/></section>}
        {selectedAudit.afterData != null && <section className="audit-modal-section audit-after-section"><h3>البيانات بعد التعديل</h3><AuditValue value={selectedAudit.afterData} compare={selectedAudit.beforeData} tone="after"/></section>}
        {!selectedAudit.details && !selectedAudit.beforeData && !selectedAudit.afterData && <p className="muted-text">لا توجد تفاصيل إضافية محفوظة لهذه العملية.</p>}
      </div><div className="modal-actions"><button className="secondary-button" onClick={() => setSelectedAudit(null)}>إغلاق التفاصيل</button>{selectedAudit.canRestore && !selectedAudit.restoredAt && can('audit.restore') && <button className="secondary-button" onClick={() => void restoreAudit(selectedAudit)}><RotateCcw size={14}/> استعادة البيانات السابقة</button>}</div>
    </Modal>}</AnimatePresence>
  </section>
}
