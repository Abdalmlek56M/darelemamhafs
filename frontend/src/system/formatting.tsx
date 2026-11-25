export function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return value.includes('T')
    ? new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' }).format(date)
    : new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

export function bytes(value: number | null) {
  if (value == null) return '—'
  if (value < 1024) return `${value} بايت`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} ك.ب`
  return `${(value / 1024 / 1024).toFixed(1)} م.ب`
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function xmlEscape(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function xmlTagName(key: string) {
  const name = key.replace(/[^A-Za-z0-9_.-]/g, '_')
  return /^[A-Za-z_]/.test(name) ? name : `field_${name}`
}

function valueToXml(tag: string, value: unknown): string {
  const safeTag = xmlTagName(tag)
  if (value == null) return `<${safeTag} nil="true"/>`
  if (Array.isArray(value)) return `<${safeTag}>${value.map(item => valueToXml('item', item)).join('')}</${safeTag}>`
  if (typeof value === 'object') {
    return `<${safeTag}>${Object.entries(value as Record<string, unknown>).map(([key, nested]) => valueToXml(key, nested)).join('')}</${safeTag}>`
  }
  return `<${safeTag}>${xmlEscape(value)}</${safeTag}>`
}

export function payloadToXml(payload: any): string {
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

export const entityLabel = (value: string | null | undefined) => value ? (entityLabels[value] ?? 'سجل') : 'غير محدد'

export function actionLabel(value: string | null | undefined, entityType?: string) {
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

export function auditFieldLabel(key: string, value: unknown): string | null {
  if (key.toLowerCase() === 'method' && typeof value === 'string' && /^(GET|POST|PUT|PATCH|DELETE)$/i.test(value)) return 'طريقة تنفيذ العملية'
  return fieldLabel(key)
}

export function displayScopes(value: string) {
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

export function AuditValue({ value, compare, tone, fieldKey }: { value: unknown; compare?: unknown; tone?: 'before' | 'after'; fieldKey?: string }) {
  const changed = tone !== undefined && JSON.stringify(value) !== JSON.stringify(compare)
  const contentClass = changed ? `audit-diff-value audit-diff-${tone}` : undefined
  if (value == null) return <span className={contentClass}>{fieldKey && financialAuditKey.test(fieldKey) ? 'غير متاح دون صلاحية قراءة المالية' : 'لا توجد بيانات'}</span>
  if (Array.isArray(value)) return value.length ? <ol className={`audit-friendly-list ${changed ? `audit-diff-list audit-diff-${tone}` : ''}`}>{value.map((item, index) => <li key={index}><AuditValue value={item} compare={Array.isArray(compare) ? compare[index] : undefined} tone={tone}/></li>)}</ol> : <span className={contentClass}>لا توجد تفاصيل</span>
  if (typeof value === 'object') {
    // Keep unknown but non-sensitive keys visible so a newly added column is never
    // silently missing from the audit diff; fall back to the raw field name.
    const entries = Object.entries(value as Record<string, unknown>).filter(([key]) => !hiddenAuditKeys.test(key))
    const compareObject = compare && typeof compare === 'object' && !Array.isArray(compare) ? compare as Record<string, unknown> : {}
    return entries.length ? <dl className="audit-friendly-data">{entries.map(([key, item]) => { const fieldChanged = tone !== undefined && JSON.stringify(item) !== JSON.stringify(compareObject[key]); return <div key={key} className={fieldChanged ? `audit-field-changed audit-field-${tone}` : undefined}><dt>{auditFieldLabel(key, item) ?? key}</dt><dd>{(key === 'scope' || key === 'scope_codes') && typeof item === 'string' ? displayScopes(item) : <AuditValue value={item} compare={compareObject[key]} tone={tone} fieldKey={key}/>}</dd></div> })}</dl> : <span className={contentClass}>لا توجد تفاصيل قابلة للعرض</span>
  }
  return <span className={contentClass}>{auditPrimitive(value)}</span>
}