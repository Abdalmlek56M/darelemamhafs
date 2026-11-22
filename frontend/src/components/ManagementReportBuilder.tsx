import { useEffect, useMemo, useState } from 'react'
import { BookOpen, CalendarDays, CheckSquare2, FileText, GraduationCap, LoaderCircle, Printer } from 'lucide-react'
import type { AdExpense, AttendanceRow, Circle, CircleStudent, CollectionRow, HistoryData, OperatingExpense, Student, StudentAttendanceRow, Teacher } from '../domain/types'
import { formatDate, money } from '../lib/formatters'
import { formatTime12 } from '../lib/dates'
import MonthPicker from './common/MonthPicker'

type ReportKind = 'school' | 'circles' | 'teacher' | 'teacher-attendance' | 'student-attendance' | 'student'
type ReportAudience = 'internal' | 'share'
type Notice = (tone: 'success' | 'error' | 'info', text: string) => void
type Props = {
  schoolName: string
  currentMonth: string
  circles: Circle[]
  teachers: Teacher[]
  students: Student[]
  permissions: string[]
  notify: Notice
}
type MonthData = { collections: CollectionRow[]; attendance: AttendanceRow[]; studentAttendance: StudentAttendanceRow[]; ads: AdExpense[]; expenses: OperatingExpense[]; rosters: Record<string, CircleStudent[]> }

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' })
  if (!response.ok) {
    let message = 'تعذر تحميل بيانات التقرير.'
    try { const body = await response.json(); message = body.message ?? body.detail ?? body.title ?? message } catch { /* no JSON response */ }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

function esc(value: unknown): string {
  return String(value ?? '—').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}
function monthName(month: string) {
  const date = new Date(`${month}-01T12:00:00`)
  return Number.isNaN(date.getTime()) ? month : new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' }).format(date)
}
function statusLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    active: 'نشط', inactive: 'غير نشط', archived: 'مؤرشف', paused: 'متوقف مؤقتًا', withdrawn: 'منسحب',
    paid: 'مسدد', partial: 'سداد جزئي', unpaid: 'غير مسدد', 'not-set': 'لم يُحدد الاستحقاق',
    present: 'حضور', absent: 'غياب', excused: 'بعذر', cancelled: 'أُلغيت الحصة',
  }
  return value ? (labels[value] ?? value) : '—'
}
function sum<T>(items: T[], fn: (item: T) => number) { return items.reduce((total, item) => total + (Number(fn(item)) || 0), 0) }
function escCell(value: unknown) { return `<td>${esc(value)}</td>` }
function table(headers: string[], rows: unknown[][], emptyText = 'لا توجد سجلات لهذا الشهر.') {
  const head = `<thead><tr>${headers.map(item => `<th>${esc(item)}</th>`).join('')}</tr></thead>`
  const body = rows.length ? `<tbody>${rows.map(row => `<tr>${row.map(escCell).join('')}</tr>`).join('')}</tbody>` : `<tbody><tr><td class="empty" colspan="${headers.length}">${esc(emptyText)}</td></tr></tbody>`
  return `<div class="table-wrap"><table>${head}${body}</table></div>`
}
function metric(label: string, value: string | number) { return `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>` }
function heading(label: string, note = '') { return `<div class="section-heading"><h2>${esc(label)}</h2>${note ? `<p>${esc(note)}</p>` : ''}</div>` }
function monthHeader(schoolName: string, title: string, month: string, subTitle = '') {
  return `<header class="report-header"><div class="brand-mark">دار الإمام حفص</div><div><h1>${esc(title)}</h1><p>${esc(schoolName)} · ${esc(monthName(month))}</p>${subTitle ? `<small>${esc(subTitle)}</small>` : ''}</div><div class="generated">تاريخ التقرير<br><strong>${esc(new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(new Date()))}</strong></div></header>`
}

function buildSchoolReport(schoolName: string, month: string, circles: Circle[], teachers: Teacher[], students: Student[], data: MonthData, permissions: string[], audience: ReportAudience) {
  const canStudents = permissions.includes('students.read')
  const canCircles = permissions.includes('circles.read')
  const canTeachers = permissions.includes('teachers.read')
  const canFinance = audience === 'internal' && permissions.includes('finance.read') && permissions.includes('reports.finance')
  const canAttendance = permissions.some(p => p === 'attendance.read' || p === 'attendance.edit')
  const present = data.attendance.filter(row => row.status === 'present')
  const due = sum(data.collections, row => row.amountDue)
  const paid = sum(data.collections, row => row.paidAmount)
  const balance = sum(data.collections, row => row.balance)
  const teacherPay = sum(present, row => row.payableAmount ?? 0)
  const activeStudents = students.filter(row => row.status === 'active').length
  const activeCircles = circles.filter(row => row.isActive).length
  const activeTeachers = teachers.filter(row => row.status === 'active').length
  const stats = [
    ...(canStudents ? [metric('الطلاب النشطون', activeStudents)] : []),
    ...(canCircles ? [metric('الحلقات النشطة', activeCircles)] : []),
    ...(canTeachers ? [metric('المعلمات النشطات', activeTeachers)] : []),
    ...(canFinance ? [metric('الاستحقاق المسجل', money(due)), metric('المحصل فعليًا', money(paid)), metric('المتبقي للتحصيل', money(balance))] : []),
    ...(canFinance && canAttendance ? [metric('أجر الحضور المسجل', money(teacherPay))] : []),
    ...(canFinance ? [metric('تكلفة الإعلانات', money(sum(data.ads, row => row.monthAmount))), metric('المصروفات التشغيلية', money(sum(data.expenses, row => row.amount)))] : []),
  ].join('')
  const circleRows = circles.map(circle => {
    const rows = data.collections.filter(row => row.circleId === circle.id)
    const ads = sum(data.ads.filter(row => row.circleId === circle.id), row => row.monthAmount)
    const base: unknown[] = [circle.name, circle.teacherName || 'لم تُحدد معلمة', canStudents ? circle.activeStudentCount : '—']
    if (canFinance) base.push(money(sum(rows, row => row.amountDue)), money(sum(rows, row => row.paidAmount)), money(sum(rows, row => row.balance)), money(ads))
    return base
  })
  const teacherSummaryRows = teachers.map(teacher => {
    const entries = data.attendance.filter(row => row.teacherId === teacher.id)
    const attended = entries.filter(row => row.status === 'present')
    const cells: unknown[] = [teacher.fullName, entries.filter(row => row.status === 'present').length, entries.filter(row => row.status === 'absent').length, entries.filter(row => row.status === 'cancelled').length, `${new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(sum(attended, row => row.durationMinutes) / 60)} ساعة`]
    if (canFinance) cells.push(money(sum(attended, row => row.payableAmount ?? 0)))
    return cells
  })
  const expenseRows = data.expenses.map(row => [formatDate(row.expenseDate), row.category, row.description, row.circleName || 'مصروف عام للدار', money(row.amount)])
  const chargedEnrollments = data.collections.filter(row => row.chargeId !== null).length
  const financeCoverageNote = canFinance && data.collections.length === 0
    ? '<p class="report-warning">لا توجد التحاقات ظاهرة لهذا الشهر؛ لا تتوفر بيانات كافية لحساب الاستحقاق والتحصيل.</p>'
    : canFinance && chargedEnrollments === 0
      ? '<p class="report-warning">لم يتم تسجيل استحقاقات شهرية لهذا الشهر؛ الأرقام المالية المعروضة لا تعني أن التحصيل مكتمل.</p>'
      : canFinance && chargedEnrollments < data.collections.length
        ? `<p class="report-warning">تم تسجيل استحقاقات لـ${new Intl.NumberFormat('ar-EG').format(chargedEnrollments)} من أصل ${new Intl.NumberFormat('ar-EG').format(data.collections.length)} التحاقًا ظاهرًا؛ راجع الحالات التي لم يُسجّل لها استحقاق.</p>`
        : ''
  const audienceLabel = 'ملخص الشهر المختار'
  const content = `${monthHeader(schoolName, 'ملخص الدار الشهري', month, `ملخص إداري مبسط · ${audienceLabel}`)}<section>${heading('أهم مؤشرات الشهر', canFinance ? 'الاستحقاق غير التحصيل؛ والمتبقي هو الفرق بينهما.' : 'الأعداد حسب الصلاحيات والبيانات المسجلة.') }${financeCoverageNote}<div class="metrics">${stats || '<p>لا تتوفر بيانات كافية لهذا الحساب.</p>'}</div></section>${canCircles ? `<section>${heading('متابعة الحلقات', canFinance ? 'الأرقام المالية تخص الشهر المختار فقط.' : 'أسماء الحلقات وعدد الطلاب النشطين.')}${table(canFinance ? ['الحلقة','المعلمة','الطلاب','المستحق','المحصل','المتبقي','إعلانات الشهر'] : ['الحلقة','المعلمة','طلاب نشطون'], circleRows, 'لا توجد حلقات مسجلة.')}</section>` : ''}${canAttendance && canTeachers ? `<section>${heading(canFinance ? 'الحضور وأجور المعلمات' : 'الحضور المسجل للمعلمات', canFinance ? 'الأجر محسوب من سجلات الحضور المسجلة فقط.' : 'يعرض الجدول الحضور والغياب والساعات دون تفاصيل مالية.')}${table(canFinance ? ['المعلمة','حضور','غياب','حصص ملغاة','ساعات حضور','الأجر المستحق'] : ['المعلمة','حضور','غياب','حصص ملغاة','ساعات حضور'], teacherSummaryRows, 'لا توجد سجلات حضور لهذا الشهر.')}</section>` : ''}${canFinance ? `<section>${heading('المصروفات التشغيلية', 'لا تشمل هذا الجدول تكاليف الإعلانات المحسوبة في بند منفصل.')}${table(['التاريخ','التصنيف','الوصف','التبعية','المبلغ'], expenseRows, 'لا توجد مصروفات تشغيلية مسجلة لهذا الشهر.')}</section>` : ''}<p class="note">هذا التقرير ملخص للبيانات المسجلة في النظام للشهر المحدد، ولا يحل محل النسخة الاحتياطية أو سجل الحركة التفصيلي.</p>`
  return htmlDocument(schoolName, 'ملخص الدار الشهري', month, 'school', content)
}

function buildCircleReport(schoolName: string, month: string, circles: Circle[], data: MonthData, permissions: string[], audience: ReportAudience) {
  const canFinance = audience === 'internal' && permissions.includes('finance.read') && permissions.includes('reports.finance')
  const canAttendance = permissions.some(p => p === 'attendance.read' || p === 'attendance.edit')
  const canCalculateNet = canFinance && canAttendance
  const pages = circles.map((circle, index) => {
    const enrollments = data.collections.filter(row => row.circleId === circle.id)
    const teacherAttendance = data.attendance.filter(row => row.circleId === circle.id)
    const studentAttendance = data.studentAttendance.filter(row => row.circleId === circle.id)
    const ads = data.ads.filter(row => row.circleId === circle.id)
    const expenses = data.expenses.filter(row => row.circleId === circle.id)
    const roster = data.rosters[circle.id] ?? []
    const billed = sum(enrollments, row => row.amountDue)
    const collected = sum(enrollments, row => row.paidAmount)
    const balance = sum(enrollments, row => row.balance)
    const teacherPay = sum(teacherAttendance.filter(row => row.status === 'present'), row => row.payableAmount ?? 0)
    const adCost = sum(ads, row => row.monthAmount)
    const linkedExpenseCost = sum(expenses, row => row.amount)
    const estimatedNet = billed - teacherPay - adCost - linkedExpenseCost
    const chargedCount = enrollments.filter(row => row.chargeId !== null).length
    const financeCoverageNote = canFinance && !canAttendance
      ? '<p class="report-warning">لا يمكن حساب صافي التشغيل بدقة لهذا الحساب لأن صلاحية قراءة الحضور غير متاحة؛ أظهرنا الاستحقاقات والتحصيل والتكاليف دون احتساب أجر المعلمة أو صافي التشغيل.</p>'
      : canFinance && chargedCount === 0
        ? '<p class="report-warning">لم تُسجّل استحقاقات لهذا الشهر؛ صافي التشغيل لا يُعتبر ربحًا نهائيًا قبل تسجيل الاستحقاقات والتكاليف كاملة.</p>'
        : canFinance && chargedCount < enrollments.length
          ? `<p class="report-warning">هناك ${new Intl.NumberFormat('ar-EG').format(enrollments.length - chargedCount)} التحاقًا بلا استحقاق مسجل لهذا الشهر؛ راجع اكتمال البيانات قبل الاعتماد على صافي التشغيل.</p>`
          : ''
    const cards = [
      metric('الحالة', statusLabel(circle.isActive ? 'active' : 'inactive')),
      metric('الطلاب النشطون', circle.activeStudentCount),
      ...(canFinance ? [
        metric('الرسوم الشهرية المتفق عليها', money(circle.monthlyFee)),
        metric('الاستحقاق المسجل', money(billed)),
        metric('المحصل فعليًا', money(collected)),
        metric('المتبقي للتحصيل', money(balance)),
        ...(canCalculateNet ? [metric('أجر المعلمة حسب الحضور', money(teacherPay))] : []),
        metric('تكلفة الإعلانات', money(adCost)),
        metric('المصروفات المرتبطة', money(linkedExpenseCost)),
        ...(canCalculateNet ? [metric('صافي تشغيل تقديري', money(estimatedNet))] : []),
      ] : []),
    ].join('')
    const studentRows: unknown[][] = canFinance
      ? enrollments.map(row => [row.studentName, money(row.agreedMonthlyFee), money(row.amountDue), money(row.paidAmount), money(row.balance), statusLabel(row.paymentStatus)])
      : roster.filter(row => row.enrollmentStatus === 'active' || row.enrollmentStatus === 'paused').map(row => [row.studentName, statusLabel(row.enrollmentStatus)])
    const studentHeaders = canFinance ? ['الطالب','الرسوم المتفق عليها','الاستحقاق','المحصل','المتبقي','حالة السداد'] : ['الطالب','حالة الالتحاق']

    type SessionReport = { date: string; startsAt: string; teacherName: string; teacherStatus: string; duration: number | null; payable: number; studentRows: StudentAttendanceRow[] }
    const sessions = new Map<string, SessionReport>()
    const ensureSession = (key: string, date: string, startsAt: string, teacherName = '') => {
      let session = sessions.get(key)
      if (!session) {
        session = { date, startsAt, teacherName: teacherName || circle.teacherName || '—', teacherStatus: 'لم يُسجل حضور المعلمة', duration: null, payable: 0, studentRows: [] }
        sessions.set(key, session)
      } else if (teacherName && (!session.teacherName || session.teacherName === '—')) session.teacherName = teacherName
      return session
    }
    for (const row of teacherAttendance) {
      const key = row.scheduleSlotId ? `${row.scheduleSlotId}|${row.sessionDate}` : `${circle.id}|${row.sessionDate}|${row.startsAt.slice(0,5)}`
      const session = ensureSession(key, row.sessionDate, row.startsAt, row.teacherName)
      session.teacherStatus = statusLabel(row.status)
      session.duration = row.durationMinutes
      session.payable = row.status === 'present' ? (row.payableAmount ?? 0) : 0
    }
    for (const row of studentAttendance) {
      const matchingTeacherRow = teacherAttendance.find(teacherRow => teacherRow.sessionDate === row.sessionDate && (teacherRow.scheduleSlotId ? teacherRow.scheduleSlotId === row.scheduleSlotId : teacherRow.startsAt.slice(0,5) === row.startsAt.slice(0,5)))
      const key = matchingTeacherRow
        ? (matchingTeacherRow.scheduleSlotId ? `${matchingTeacherRow.scheduleSlotId}|${matchingTeacherRow.sessionDate}` : `${circle.id}|${matchingTeacherRow.sessionDate}|${matchingTeacherRow.startsAt.slice(0,5)}`)
        : `${row.scheduleSlotId}|${row.sessionDate}`
      const session = ensureSession(key, row.sessionDate, row.startsAt, row.teacherName)
      session.studentRows.push(row)
    }
    const sessionRows: unknown[][] = Array.from(sessions.values())
      .sort((a,b) => a.date.localeCompare(b.date) || a.startsAt.localeCompare(b.startsAt))
      .map(session => {
        const present = session.studentRows.filter(row => row.status === 'present')
        const absent = session.studentRows.filter(row => row.status === 'absent').length
        const excused = session.studentRows.filter(row => row.status === 'excused').length
        const presentNames = present.map(row => row.studentName).join('، ')
        return [
          formatDate(session.date), formatTime12(session.startsAt), session.teacherName, session.teacherStatus,
          session.duration == null ? '—' : `${session.duration} دقيقة`,
          ...(canFinance ? [session.teacherStatus === 'حضور' ? money(session.payable) : '—'] : []),
          session.studentRows.length === 0 ? 'لم يُسجل حضور الطلاب' : present.length ? `${presentNames} (${present.length})` : 'لم يُسجل طالب حاضر',
          session.studentRows.length ? absent : '—', session.studentRows.length ? excused : '—',
        ]
      })
    const financeRows: unknown[][] = [
      ['الاستحقاق المسجل', money(billed)],
      ['المحصل فعليًا', money(collected)],
      ['المتبقي للتحصيل', money(balance)],
      ...(canCalculateNet ? [['أجر المعلمة حسب الحضور المسجل', money(teacherPay)]] : []),
      ['تكلفة الإعلانات للشهر', money(adCost)],
      ['المصروفات التشغيلية المرتبطة بالحلقة', money(linkedExpenseCost)],
      ...(canCalculateNet ? [['صافي تشغيل تقديري', money(estimatedNet)]] : []),
    ]
    const expenseRows = [
      ...ads.map(row => [formatDate(row.startDate), 'إعلان', `${row.platform || 'حملة إعلانية'} · ${row.overlapDays} يوم`, money(row.monthAmount)]),
      ...expenses.map(row => [formatDate(row.expenseDate), row.category, row.description, money(row.amount)]),
    ]
    return `<article class="report-page ${index ? 'new-page' : ''}">${monthHeader(schoolName, `تقرير حلقة: ${circle.name}`, month, 'تقرير مستقل للحلقة')}<section>${heading('بيانات الحلقة')}<div class="detail-strip"><div><span>المعلمة</span><strong>${esc(circle.teacherName || 'لم تُحدد معلمة')}</strong></div><div><span>موعد الحلقة</span><strong>${esc(circle.scheduleText || 'يراجع جدول المواعيد')}</strong></div><div><span>حالة الحلقة</span><strong>${esc(statusLabel(circle.isActive ? 'active' : 'inactive'))}</strong></div></div><div class="metrics">${cards}</div></section>${canFinance ? `${financeCoverageNote}<section>${heading('ملخص النتيجة التشغيلية',canCalculateNet ? 'صافي التشغيل التقديري = الاستحقاق المسجل − أجر المعلمة − الإعلانات − المصروفات المرتبطة. المحصل والمتبقي معروضان منفصلين ولا يحل أحدهما محل الآخر.' : 'المحصل والمتبقي معروضان منفصلين؛ صافي التشغيل يحتاج صلاحية قراءة الحضور حتى يُحتسب أجر المعلمة.')}${table(['البند','القيمة'], financeRows, 'لا توجد بيانات مالية مسجلة.')}</section>` : ''}<section>${heading(canFinance ? 'الطلاب والاشتراكات' : 'الطلاب المسجلون حاليًا', canFinance ? 'الرسوم ظاهرة للإدارة المخوّلة فقط.' : 'قائمة الالتحاقات الحالية.')}${table(studentHeaders, studentRows, 'لا توجد التحاقات ظاهرة لهذه الحلقة.')}</section>${canAttendance ? `<section>${heading(canFinance ? 'الحضور في كل حصة وأجر المعلمة' : 'الحضور في كل حصة', 'أسماء الطلاب الحاضرين مأخوذة من تسجيل الحضور المحفوظ لنفس الحلقة والتاريخ والموعد.')}${table(canFinance ? ['التاريخ','الوقت','المعلمة','حالة حضور المعلمة','المدة','أجر الحصة','الطلاب الحاضرون','غياب','بعذر'] : ['التاريخ','الوقت','المعلمة','حالة حضور المعلمة','المدة','الطلاب الحاضرون','غياب','بعذر'], sessionRows, 'لا توجد سجلات حضور محفوظة لهذه الحلقة في الشهر المحدد.')}</section>` : ''}${canFinance ? `<section>${heading('تفاصيل تكاليف الحلقة','الإعلانات محسوبة بتكلفة أيامها داخل الشهر المختار.')}${table(['التاريخ','النوع','البيان','المبلغ'], expenseRows, 'لا توجد إعلانات أو مصروفات مرتبطة بهذه الحلقة في الشهر المحدد.')}</section>` : ''}<p class="note">صافي التشغيل هنا تقديري ويعتمد على السجلات المدخلة؛ لا يعني أن كل الاستحقاقات حُصّلت أو أن كل المصروفات دُفعت فعليًا.</p></article>`
  }).join('')
  return htmlDocument(schoolName, circles.length === 1 ? `تقرير حلقة ${circles[0].name}` : 'تقارير الحلقات المختارة', month, 'circles', pages)
}

function buildTeacherReport(schoolName: string, month: string, teacher: Teacher, circles: Circle[], data: MonthData, permissions: string[]) {
  const linked = circles.filter(circle => circle.teacherId === teacher.id)
  const attendance = data.attendance.filter(row => row.teacherId === teacher.id)
  const present = attendance.filter(row => row.status === 'present')
  const canTeacherPay = permissions.includes('finance.read') && permissions.includes('reports.finance') && permissions.some(p => p === 'attendance.read' || p === 'attendance.edit')
  const hours = sum(present, row => row.durationMinutes) / 60
  const attendanceRows = attendance.map(row => {
    const sameSession = data.studentAttendance.filter(student => student.sessionDate === row.sessionDate && (
      row.scheduleSlotId ? student.scheduleSlotId === row.scheduleSlotId : student.circleId === row.circleId && student.startsAt.slice(0,5) === row.startsAt.slice(0,5)
    ))
    const presentStudentCount = sameSession.filter(student => student.status === 'present').length
    const studentSummary = row.status !== 'present'
      ? (row.status === 'cancelled' ? 'الحصة ملغاة' : 'لم تحضر المعلمة')
      : sameSession.length === 0
        ? 'لم يُسجل حضور الطلاب'
        : `${new Intl.NumberFormat('ar-EG').format(presentStudentCount)} طالب`
    const cells: unknown[] = [formatDate(row.sessionDate), row.circleName, formatTime12(row.startsAt), statusLabel(row.status), `${row.durationMinutes} دقيقة`, studentSummary]
    if (canTeacherPay) cells.push(row.status === 'present' ? money(row.payableAmount) : '—')
    return cells
  })
  const circleRows = linked.map(circle => [circle.name, circle.scheduleText || 'يراجع جدول المواعيد', statusLabel(circle.isActive ? 'active' : 'inactive'), circle.activeStudentCount])
  const payoutNote = canTeacherPay
    ? 'المستحق محسوب من الحصص التي سُجل حضورها في الشهر المختار.'
    : 'كشف الحضور والساعات المسجلة للشهر المختار.'
  const content = `<article class="report-page">${monthHeader(schoolName, `كشف مستحقات المعلمة: ${teacher.fullName}`, month, 'كشف شهري للحضور والساعات والحلقات المسندة')}<div class="detail-strip"><div><span>اسم المعلمة</span><strong>${esc(teacher.fullName)}</strong></div><div><span>حالة المعلمة</span><strong>${esc(statusLabel(teacher.status))}</strong></div><div><span>عدد الحلقات المسندة</span><strong>${linked.length}</strong></div><div><span>عدد الطلاب في الحلقات</span><strong>${linked.reduce((total, circle) => total + circle.activeStudentCount, 0)}</strong></div></div>${heading('ملخص الشهر', payoutNote)}<div class="metrics">${metric('حضور مسجل', attendance.filter(row => row.status === 'present').length)}${metric('غياب مسجل', attendance.filter(row => row.status === 'absent').length)}${metric('حصص ملغاة', attendance.filter(row => row.status === 'cancelled').length)}${metric('ساعات الحضور', `${new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(hours)} ساعة`)}${canTeacherPay ? metric('إجمالي المستحق حسب الحضور', money(sum(present, row => row.payableAmount ?? 0))) : ''}</div><section>${heading('الحلقات المسندة','عدد الطلاب النشطين في كل حلقة.')}${table(['الحلقة','موعد الحلقة','الحالة','عدد الطلاب النشطين'], circleRows, 'لا توجد حلقات مسندة لهذه المعلمة.')}</section><section>${heading('تفاصيل الحصص','مدة كل حصة هي المدة المعتمدة بعد أي تعديل محفوظ.')}${table(canTeacherPay ? ['التاريخ','الحلقة','الوقت','الحالة','المدة','عدد الطلاب الحاضرين معها','المستحق لهذه الحصة'] : ['التاريخ','الحلقة','الوقت','الحالة','المدة','عدد الطلاب الحاضرين معها'], attendanceRows, 'لا توجد سجلات حضور لهذه المعلمة في الشهر المحدد.')}</section><p class="note">تم إعداد الكشف من سجلات الحضور المحفوظة حتى تاريخ إصداره.</p></article>`
  return htmlDocument(schoolName, `كشف مستحقات المعلمة ${teacher.fullName}`, month, 'teacher', content)
}

function buildTeacherAttendanceReport(schoolName: string, month: string, teachers: Teacher[], circles: Circle[], data: MonthData, permissions: string[]) {
  const canTeacherPay = permissions.includes('finance.read') && permissions.includes('reports.finance') && permissions.some(p => p === 'attendance.read' || p === 'attendance.edit')
  const rows = teachers.map(teacher => {
    const entries = data.attendance.filter(row => row.teacherId === teacher.id)
    const present = entries.filter(row => row.status === 'present')
    const hours = sum(present, row => row.durationMinutes) / 60
    const cells: unknown[] = [teacher.fullName, circles.filter(circle => circle.teacherId === teacher.id).length, present.length, entries.filter(row => row.status === 'absent').length, entries.filter(row => row.status === 'cancelled').length, `${new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(hours)} ساعة`]
    if (canTeacherPay) cells.push(money(sum(present, row => row.payableAmount ?? 0)))
    return { cells, sessions: entries }
  }).map(row => row.cells)
  const content = `${monthHeader(schoolName,'كشف حضور المعلمات الشهري',month,'ملخص مجمع للمراجعة الإدارية')}<section>${heading('ملخص الحضور','يجمع السجلات حسب المعلمة. لا يُحتسب أجر للحصص التي لم تسجل كحضور.')}${table(canTeacherPay?['المعلمة','الحلقات','حضور','غياب','حصص ملغاة','ساعات الحضور','المستحق حسب الحضور']:['المعلمة','الحلقات','حضور','غياب','حصص ملغاة','ساعات الحضور'],rows,'لا توجد سجلات حضور لهذا الشهر.')}</section><p class="note">إجمالي المستحق، عند ظهوره، محسوب من مدة الحصة وأجر الساعة المسجلين في سجل الحضور؛ ولا يعني أن الصرف الفعلي قد تم.</p>`
  return htmlDocument(schoolName,'كشف حضور المعلمات',month,'teacher-attendance',content)
}

function buildStudentAttendanceReport(schoolName: string, month: string, circles: Circle[], data: MonthData) {
  const pages = circles.map((circle, index) => {
    const rows = data.studentAttendance.filter(row => row.circleId === circle.id).map(row => [formatDate(row.sessionDate), formatTime12(row.startsAt), row.studentName, row.studentCode, statusLabel(row.status), row.teacherName || circle.teacherName || '—'])
    const present = data.studentAttendance.filter(row => row.circleId === circle.id && row.status === 'present').length
    const absent = data.studentAttendance.filter(row => row.circleId === circle.id && row.status === 'absent').length
    const excused = data.studentAttendance.filter(row => row.circleId === circle.id && row.status === 'excused').length
    return `<article class="report-page ${index ? 'new-page' : ''}">${monthHeader(schoolName,`كشف حضور الطلاب: ${circle.name}`,month,'سجل حضور شهري للحلقة')}<div class="detail-strip"><div><span>الحلقة</span><strong>${esc(circle.name)}</strong></div><div><span>المعلمة</span><strong>${esc(circle.teacherName || 'غير محددة')}</strong></div><div><span>حضور مسجل</span><strong>${present}</strong></div><div><span>غياب مسجل</span><strong>${absent} · بعذر ${excused}</strong></div></div><section>${heading('سجل الحضور','كل صف يمثل تسجيلًا محفوظًا لطالب في حصة محددة.')}${table(['التاريخ','الوقت','اسم الطالب','الكود','الحالة','المعلمة'],rows,'لا توجد سجلات حضور طلاب محفوظة لهذه الحلقة في الشهر المحدد.')}</section></article>`
  }).join('')
  return htmlDocument(schoolName,circles.length===1?`كشف حضور الطلاب · ${circles[0].name}`:'كشف حضور الطلاب للحلقات المختارة',month,'student-attendance',pages)
}

function buildStudentReport(schoolName: string, month: string, history: HistoryData, data: MonthData, permissions: string[], audience: ReportAudience) {
  const student = history.student
  const attendance = data.studentAttendance.filter(row => row.studentId === student.id)
  const enrollments = history.enrollments.map(row => [row.circleName,row.teacherName || 'غير محددة',formatDate(row.startsOn),row.endsOn ? formatDate(row.endsOn) : 'مستمر',statusLabel(row.status)])
  const attendanceRows = attendance.map(row => [formatDate(row.sessionDate),row.circleName,formatTime12(row.startsAt),statusLabel(row.status),row.teacherName || '—'])
  const canFinance = audience === 'internal' && permissions.includes('finance.read') && permissions.includes('reports.finance')
  const charges = canFinance ? history.charges.map(row => [row.billingMonth,row.circleName,money(row.amountDue),money(row.paidAmount),money(row.balance),statusLabel(row.balance<=0?'paid':row.paidAmount>0?'partial':'unpaid')]) : []
  const notes = audience === 'internal' ? history.notes.map(row => [formatDate(row.createdAt),row.noteText,row.createdBy || '—']) : []
  const content = `${monthHeader(schoolName,`الملف الإداري للطالب: ${student.fullName}`,month,'ملخص سجل الطالب')}<div class="detail-strip"><div><span>اسم الطالب</span><strong>${esc(student.fullName)}</strong></div><div><span>الكود</span><strong>${esc(student.studentCode)}</strong></div><div><span>الحالة</span><strong>${esc(statusLabel(student.status))}</strong></div><div><span>تاريخ الالتحاق</span><strong>${esc(formatDate(student.joinedOn))}</strong></div></div><section>${heading('سجل الحلقات')}${table(['الحلقة','المعلمة','من','إلى','الحالة'],enrollments,'لا توجد التحاقات محفوظة.')}</section><section>${heading('الحضور المسجل للشهر')}${table(['التاريخ','الحلقة','الوقت','الحالة','المعلمة'],attendanceRows,'لا توجد سجلات حضور لهذا الطالب في الشهر المحدد.')}</section>${canFinance?`<section>${heading('الاستحقاقات والتحصيل','الاستحقاق والتحصيل والمتبقي كلٌّ في عموده.')}${table(['الشهر','الحلقة','المستحق','المحصل','المتبقي','الحالة'],charges,'لا توجد استحقاقات محفوظة لهذا الطالب.')}</section>`:''}${notes.length?`<section>${heading('الملاحظات المسجلة')}${table(['التاريخ','الملاحظة','سجلها'],notes,'لا توجد ملاحظات.')}</section>`:''}<p class="note">هذا الملخص يعرض السجلات المحفوظة في النظام، ولا يغني عن النسخة الاحتياطية.</p>`
  return htmlDocument(schoolName,`الملف الإداري للطالب ${student.fullName}`,month,'student',content)
}

function htmlDocument(schoolName: string, title: string, month: string, kind: ReportKind, content: string) {
  const pageSize = kind === 'school' ? 'A4 landscape' : 'A4 portrait'
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} - ${esc(schoolName)} - ${esc(month)}</title><style>
  *{box-sizing:border-box}html{background:#fff}body{font-family:Tahoma,Arial,sans-serif;color:#172536;background:#fff;margin:22px;font-size:12px;line-height:1.65}h1{font-size:23px;line-height:1.45;margin:0 0 4px;color:#172536}h2{font-size:16px;margin:0;color:#203b56}p{margin:5px 0}.report-header{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:16px;border-bottom:3px solid #177b70;padding-bottom:15px;margin-bottom:18px}.brand-mark{display:grid;place-items:center;min-width:82px;height:82px;border-radius:16px;background:#eef6f5;color:#176b62;font-size:12px;font-weight:bold;padding:8px;text-align:center;border:1px solid #d3e8e4}.report-header p{color:#536579;font-size:12px}.report-header small{color:#63748a}.generated{font-size:10px;color:#68798c;text-align:left;white-space:nowrap}.generated strong{font-size:11px;color:#21364c}.section-heading{display:flex;justify-content:space-between;align-items:end;gap:12px;margin:18px 0 9px;break-after:avoid}.section-heading p{font-size:10px;color:#66778a;margin:0}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:8px 0 16px}.metric{display:flex;flex-direction:column;gap:5px;padding:11px 12px;border:1px solid #d8e0e8;border-radius:10px;background:#f8fafc;min-width:0}.metric span{font-size:10px;color:#5a6b7d}.metric strong{font-size:15px;font-weight:700;color:#203a54;overflow-wrap:anywhere}.table-wrap{width:100%;overflow:visible}table{width:100%;border-collapse:collapse;table-layout:auto;font-size:10.5px;margin-bottom:12px}thead{display:table-header-group}th,td{padding:7px 8px;border:1px solid #d1dbe5;text-align:right;vertical-align:top;overflow-wrap:anywhere}th{background:#e9eff5;color:#21384f;font-weight:bold;white-space:normal}tbody tr:nth-child(even){background:#f8fafc}tr{break-inside:avoid;page-break-inside:avoid}.empty{text-align:center;color:#738196;padding:16px}.detail-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:10px 0 14px}.detail-strip>div{display:grid;gap:4px;padding:10px;border:1px solid #d8e0e8;border-radius:9px;background:#fff;min-width:0}.detail-strip span{color:#66778a;font-size:10px}.detail-strip strong{font-size:12px;overflow-wrap:anywhere}.report-page{break-inside:auto}.report-page.new-page{break-before:page;page-break-before:always}.report-warning{font-size:10px;color:#8a4b14;background:#fff6e8;border-right:3px solid #d28a36;padding:8px 10px;margin:6px 0 12px}.note{font-size:10px;color:#66778a;border-top:1px solid #d9e1e8;padding-top:10px;margin-top:18px}.report-footer{font-size:9px;color:#8290a0;border-top:1px solid #d9e1e8;margin-top:20px;padding-top:8px}.print-actions{display:flex;justify-content:flex-start;gap:8px;margin-bottom:15px}.print-actions button{border:0;border-radius:8px;padding:10px 14px;background:#176b62;color:white;font:inherit;cursor:pointer}.report-content{max-width:1200px;margin:0 auto}@page{size:${pageSize};margin:12mm}@media print{body{margin:0;font-size:10px}.print-actions{display:none!important}.report-header{margin-bottom:12px}.metrics{gap:6px}.metric{padding:8px 9px}.metric strong{font-size:13px}th,td{padding:5px 6px}.section-heading{margin-top:12px}.report-footer{position:static}}@media(max-width:700px){.report-header{grid-template-columns:auto 1fr}.generated{grid-column:1/-1;text-align:right}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.detail-strip{grid-template-columns:repeat(2,minmax(0,1fr))}}
  </style></head><body><div class="print-actions"><button onclick="window.print()">طباعة / حفظ PDF</button></div><main class="report-content">${content}<footer class="report-footer">${esc(schoolName)} · ${esc(title)} · ${esc(monthName(month))} · ${esc(new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(new Date()))}</footer></main><script>window.addEventListener('load',()=>window.setTimeout(()=>window.print(),500))</script></body></html>`
}

export default function ManagementReportBuilder({ schoolName, currentMonth, circles, teachers, students, permissions, notify }: Props) {
  const [kind, setKind] = useState<ReportKind>('school')
  const [audience, setAudience] = useState<ReportAudience>('internal')
  const [month, setMonth] = useState(currentMonth || new Date().toISOString().slice(0,7))
  const [circleIds, setCircleIds] = useState<string[]>([])
  const [teacherId, setTeacherId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [studentQuery, setStudentQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const financeAllowed = permissions.includes('finance.read') && permissions.includes('reports.finance')
  const attendanceAllowed = permissions.some(code => code === 'attendance.read' || code === 'attendance.edit')
  const reportCircles = useMemo(() => circles.filter(circle => circleIds.includes(circle.id)), [circles, circleIds])
  const selectedTeacher = teachers.find(teacher => teacher.id === teacherId)
  const selectedStudent = students.find(student => student.id === studentId)
  const filteredStudents = useMemo(() => {
    const query = studentQuery.trim().toLocaleLowerCase('ar')
    return students.filter(student => !query || student.fullName.toLocaleLowerCase('ar').includes(query) || student.studentCode.toLocaleLowerCase('ar').includes(query)).slice(0,100)
  }, [students, studentQuery])

  useEffect(() => { if (currentMonth) setMonth(currentMonth) }, [currentMonth])
  useEffect(() => { if (!teacherId && teachers.length) setTeacherId(teachers[0].id); else if (teacherId && !teachers.some(teacher => teacher.id === teacherId)) setTeacherId(teachers[0]?.id ?? '') }, [teachers, teacherId])
  useEffect(() => { if (studentId && !students.some(student => student.id === studentId)) setStudentId('') }, [students, studentId])

  const toggleCircle = (id: string) => setCircleIds(old => old.includes(id) ? old.filter(value => value !== id) : [...old, id])
  const needsCircles = kind === 'circles' || kind === 'student-attendance'
  const buildReport = async () => {
    if (!/^\d{4}-\d{2}$/.test(month)) { notify('error', 'اختَر شهرًا صحيحًا للتقرير.'); return }
    if (needsCircles && reportCircles.length === 0) { notify('error', 'اختَر حلقة واحدة على الأقل.'); return }
    if (kind === 'teacher' && !selectedTeacher) { notify('error', 'اختَر المعلمة المطلوبة.'); return }
    if (kind === 'student' && !selectedStudent) { notify('error', 'ابحث عن الطالب بالاسم أو الكود واختَره.'); return }
    const printWindow = window.open('about:blank', '_blank')
    if (!printWindow) { notify('error', 'اسمح بفتح نافذة التقرير من إعدادات التطبيق ثم أعد المحاولة.'); return }
    setLoading(true)
    try {
      const [collections, attendance, studentAttendance, ads, expenses] = await Promise.all([
        financeAllowed && audience === 'internal' && kind !== 'teacher' ? getJson<CollectionRow[]>(`/api/collections?month=${encodeURIComponent(month)}`) : Promise.resolve([] as CollectionRow[]),
        attendanceAllowed ? getJson<AttendanceRow[]>(`/api/teacher-attendance?month=${encodeURIComponent(month)}`) : Promise.resolve([] as AttendanceRow[]),
        attendanceAllowed && (kind === 'circles' || kind === 'teacher' || kind === 'student-attendance' || kind === 'student') ? getJson<StudentAttendanceRow[]>(`/api/student-attendance?month=${encodeURIComponent(month)}`) : Promise.resolve([] as StudentAttendanceRow[]),
        financeAllowed && audience === 'internal' && kind !== 'teacher' ? getJson<AdExpense[]>(`/api/advertising-expenses?month=${encodeURIComponent(month)}`) : Promise.resolve([] as AdExpense[]),
        financeAllowed && audience === 'internal' && kind !== 'teacher' ? getJson<OperatingExpense[]>(`/api/operating-expenses?month=${encodeURIComponent(month)}`) : Promise.resolve([] as OperatingExpense[]),
      ])
      const rosters: Record<string, CircleStudent[]> = {}
      if (kind === 'circles') {
        const results = await Promise.all(reportCircles.map(async circle => [circle.id, await getJson<CircleStudent[]>(`/api/circles/${circle.id}/students`)] as const))
        for (const [circleId, rows] of results) rosters[circleId] = rows
      }
      const history = kind === 'student' ? await getJson<HistoryData>(`/api/students/${selectedStudent!.id}/history`) : null
      const data: MonthData = { collections, attendance, studentAttendance, ads, expenses, rosters }
      const html = kind === 'school'
        ? buildSchoolReport(schoolName, month, circles, teachers, students, data, permissions, audience)
        : kind === 'circles'
          ? buildCircleReport(schoolName, month, reportCircles, data, permissions, audience)
          : kind === 'teacher'
            ? buildTeacherReport(schoolName, month, selectedTeacher!, circles, data, permissions)
            : kind === 'teacher-attendance'
              ? buildTeacherAttendanceReport(schoolName, month, teachers, circles, data, permissions)
              : kind === 'student-attendance'
                ? buildStudentAttendanceReport(schoolName, month, reportCircles, data)
                : buildStudentReport(schoolName, month, history!, data, permissions, audience)
      printWindow.document.open(); printWindow.document.write(html); printWindow.document.close()
      {
        try {
          const logged = await fetch('/api/admin/audit-events', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionCode: 'report.create', entityType: kind === 'teacher' ? 'teacher' : kind === 'student' ? 'student' : (kind === 'circles' || kind === 'student-attendance') && reportCircles.length === 1 ? 'circle' : 'report', entityId: kind === 'teacher' ? selectedTeacher?.id : kind === 'student' ? selectedStudent?.id : (kind === 'circles' || kind === 'student-attendance') && reportCircles.length === 1 ? reportCircles[0].id : null, details: { kind, month, audience, circleCount: reportCircles.length, targetLabel: kind === 'teacher' ? selectedTeacher?.fullName : kind === 'student' ? selectedStudent?.fullName : (kind === 'circles' || kind === 'student-attendance') ? reportCircles.map(circle => circle.name).join('، ') : 'ملخص الدار', teacherId: selectedTeacher?.id ?? null, studentId: selectedStudent?.id ?? null } }) })
          if (!logged.ok) notify('info', 'تم تجهيز التقرير، لكن تعذر تسجيل عملية إعداده في سجل التغييرات.')
        } catch { notify('info', 'تم تجهيز التقرير، لكن تعذر الاتصال بسجل التغييرات.') }
      }
      notify('info', 'اتفتح التقرير. من نافذة الطباعة اختَر «حفظ كـ PDF» أو اطبعه مباشرة.')
    } catch (error) {
      printWindow.close()
      notify('error', error instanceof Error ? error.message : 'تعذر تجهيز التقرير.')
    } finally { setLoading(false) }
  }

  return <section className="management-report-builder">
    <div className="system-panel-heading"><div><span className="eyebrow">تقارير للإدارة والمشاركة</span><h3>إعداد تقرير PDF</h3><p>تقرير مفهوم بالأسماء والأرقام المهمة فقط؛ منفصل عن نسخة البيانات الكاملة.</p></div><span className="system-heading-icon"><FileText size={20}/></span></div>
    <div className="report-kind-grid" role="radiogroup" aria-label="نوع التقرير">
      <button type="button" className={`report-kind-option ${kind === 'school' ? 'active' : ''}`} onClick={() => setKind('school')}><BookOpen size={18}/><span><strong>ملخص الدار</strong><small>مؤشرات الشهر والحلقات والماليات</small></span></button>
      <button type="button" className={`report-kind-option ${kind === 'circles' ? 'active' : ''}`} onClick={() => setKind('circles')}><CheckSquare2 size={18}/><span><strong>تقارير الحلقات</strong><small>حلقة واحدة أو عدة حلقات، كل حلقة مستقلة</small></span></button>
      <button type="button" className={`report-kind-option ${kind === 'teacher' ? 'active' : ''}`} onClick={() => setKind('teacher')}><GraduationCap size={18}/><span><strong>كشف مستحقات معلمة</strong><small>الحضور والأجر وعدد الطلاب فقط دون رسومهم</small></span></button>
      <button type="button" className={`report-kind-option ${kind === 'teacher-attendance' ? 'active' : ''}`} onClick={() => setKind('teacher-attendance')}><CalendarDays size={18}/><span><strong>حضور المعلمات</strong><small>ملخص مجمع للحضور والغياب والساعات</small></span></button>
      <button type="button" className={`report-kind-option ${kind === 'student-attendance' ? 'active' : ''}`} onClick={() => setKind('student-attendance')}><CheckSquare2 size={18}/><span><strong>حضور الطلاب</strong><small>سجل الحضور مقسمًا حسب الحلقة</small></span></button>
      <button type="button" className={`report-kind-option ${kind === 'student' ? 'active' : ''}`} onClick={() => setKind('student')}><FileText size={18}/><span><strong>تقرير طالب</strong><small>ابحث بالاسم أو الكود واستخرج ملفه</small></span></button>
    </div>
    {(kind !== 'teacher' && kind !== 'teacher-attendance' && kind !== 'student-attendance') && <div className="report-audience-row"><strong>محتوى التقرير</strong><div className="report-audience-options"><button type="button" className={audience === 'internal' ? 'active' : ''} onClick={() => setAudience('internal')}>تقرير إداري</button><button type="button" className={audience === 'share' ? 'active' : ''} onClick={() => setAudience('share')}>نسخة للمشاركة</button></div><small>{audience === 'share' ? 'تُخفى البيانات المالية التفصيلية في التقرير المرسل للمشاركة.' : 'تظهر المعلومات المالية المتاحة لصلاحية حسابك.'}</small></div>}
    {permissions.includes('finance.read') && !permissions.includes('reports.finance') && <div className="inline-notice warning-notice">صلاحية <code>reports.finance</code> غير مفعّلة لهذا الحساب؛ لذلك تُخفى الأعمدة المالية من التقارير.</div>}
    <div className="report-builder-controls">
      <label className="form-field report-month-field"><span><CalendarDays size={14}/> شهر التقرير</span><MonthPicker value={month} onChange={setMonth} ariaLabel="شهر التقرير"/></label>
      {needsCircles && <div className="report-circle-picker"><div className="report-picker-heading"><strong>اختيار الحلقات</strong><div><button type="button" className="text-link" onClick={() => setCircleIds(circles.map(circle => circle.id))}>تحديد الكل</button><button type="button" className="text-link" onClick={() => setCircleIds([])}>إلغاء التحديد</button></div></div><div className="report-circle-options">{circles.map(circle => <label key={circle.id} className="report-circle-option"><input type="checkbox" checked={circleIds.includes(circle.id)} onChange={() => toggleCircle(circle.id)}/><span><strong>{circle.name}</strong><small>{circle.teacherName || 'لم تُحدد معلمة'} · {circle.activeStudentCount} طالب نشط</small></span></label>)}{circles.length === 0 && <p className="muted-text">لا توجد حلقات متاحة لهذا الحساب.</p>}</div><small className="report-selection-count">تم اختيار {reportCircles.length} حلقة</small></div>}
      {kind === 'teacher' && <label className="form-field report-teacher-field"><span>المعلمة</span><select value={teacherId} onChange={event => setTeacherId(event.target.value)} required><option value="">اختَر المعلمة</option>{teachers.map(teacher => <option value={teacher.id} key={teacher.id}>{teacher.fullName}</option>)}</select></label>}
      {kind === 'student' && <div className="report-student-search"><label className="form-field"><span>البحث بالاسم أو الكود</span><input type="search" value={studentQuery} onChange={event => setStudentQuery(event.target.value)} placeholder="اكتب اسم الطالب أو كوده"/></label><label className="form-field"><span>الطالب</span><select value={studentId} onChange={event => setStudentId(event.target.value)} required><option value="">اختَر الطالب</option>{filteredStudents.map(student => <option value={student.id} key={student.id}>{student.fullName} · {student.studentCode}</option>)}</select></label></div>}
    </div>
    <div className="report-builder-footer"><p>{kind === 'teacher' ? 'كشف المعلمة يعرض عدد الطلاب في كل حلقة دون رسومهم الفردية، ويحسب المستحق من الحضور المسجل.' : 'التقرير يستخدم بيانات الشهر المختار، ويقسم بيانات الحلقات في أجزاء مستقلة عند الاختيار الجماعي.'}</p><button type="button" className="primary-button" onClick={() => void buildReport()} disabled={loading || (needsCircles && reportCircles.length === 0) || (kind === 'teacher' && !selectedTeacher) || (kind === 'student' && !selectedStudent)}>{loading ? <LoaderCircle className="spin" size={16}/> : <Printer size={16}/>} {loading ? 'جارٍ تجهيز التقرير…' : 'عرض التقرير / حفظ PDF'}</button></div>
  </section>
}
