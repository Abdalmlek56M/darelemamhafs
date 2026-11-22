import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import type { Theme, Branding, Page, Gate, StudentStatus, TeacherStatus, Session, Student, Teacher, Circle, CollectionRow, Permission, AdminUser, SavedReport, HistoryData, CircleStudent, Notice, StudentForm, TeacherForm, CircleForm, CircleScheduleDraft, EnrollmentForm, ChargeForm, PaymentForm, UserForm, ReportSnapshot, ScheduleSlot, AttendanceRow, AdExpense, AdExpenseForm, OperatingExpense, OperatingExpenseForm, CircleProfitSummary, TeacherPaySummary, TeacherHistoryData, StudentAttendanceSummary, VoidTarget } from '../domain/types'
import { defaultBranding, weekDays, blankAdExpense, blankOperatingExpense, blankStudent, blankTeacher, blankCircle, blankEnrollment, blankCharge, blankPayment } from '../domain/defaults'
import { FINANCE_VOID_PERMISSION, VOID_REASON_MAX_LENGTH, VOID_REASON_MIN_LENGTH } from '../system/constants'
import { statusLabels } from '../domain/labels'
import { localDateString, localDateKey, currentMonth, formatTime12 } from '../lib/dates'
import { formatDate, money } from '../lib/formatters'
import { safeDownload, toCsv, makeReportSvg } from '../lib/reportExports'
import { request, requestForm } from '../services/apiClient'
import { navItems } from '../domain/navigation'
import useScheduleNotifications from './useScheduleNotifications'
import useDarDataLoaders from './useDarDataLoaders'
import useDarAuth from './useDarAuth'
import useStudentActions from './useStudentActions'
import useTeacherActions from './useTeacherActions'
import useCircleActions from './useCircleActions'
import useUserActions from './useUserActions'
import { downloadProfitSummary as exportProfitSummary } from './profitSummaryReport'
import {
  getNextSessions,
  getMonthSessions,
  getMonthlyTeacherPay,
  getSuggestedMonthlyCharge,
  getFilteredStudents,
  getFilteredTeachers,
  getCurrentMonthTotals,
  getMonthlyTeacherPayTotal,
  getMonthlyAdvertisingTotal,
  getMonthlyOperatingExpenseTotal,
  getDashboardProfit,
  getTeacherPaySummary,
  getCircleProfitSummary,
} from './selectors'
import { confirmAction } from '../components/common/confirmService'

export default function useDarApplication() {

  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('dar-theme') as Theme) || 'dark')
  const [gate, setGate] = useState<Gate>('checking')
  const [branding, setBranding] = useState<Branding>(() => ({ ...defaultBranding, brandName: localStorage.getItem('dar-brand-name') || defaultBranding.brandName }))
  const [avatarVersion, setAvatarVersion] = useState(0)
  const [avatarAvailable, setAvatarAvailable] = useState(true)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [page, setPage] = useState<Page>('dashboard')
  const [health, setHealth] = useState<'checking' | 'connected' | 'down'>('checking')
  const [students, setStudents] = useState<Student[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [circles, setCircles] = useState<Circle[]>([])
  const [scheduleSlots, setScheduleSlots] = useState<ScheduleSlot[]>([])
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([])
  const [studentAttendanceSummaries, setStudentAttendanceSummaries] = useState<StudentAttendanceSummary[]>([])
  const [advertisingExpenses, setAdvertisingExpenses] = useState<AdExpense[]>([])
  const [operatingExpenses, setOperatingExpenses] = useState<OperatingExpense[]>([])
  const [operatingExpenseForm, setOperatingExpenseForm] = useState<OperatingExpenseForm>(blankOperatingExpense)
  const [editingOperatingExpenseId, setEditingOperatingExpenseId] = useState<string | null>(null)
  const [scheduleForm, setScheduleForm] = useState({ circleId: '', dayOfWeek: '0', startsAt: '20:00', durationMinutes: '60' })
  const [adExpenseForm, setAdExpenseForm] = useState<AdExpenseForm>(blankAdExpense)
  const [paymentReceipt, setPaymentReceipt] = useState<File | null>(null)
  const [paymentReceiptPreview, setPaymentReceiptPreview] = useState<string | null>(null)
  const [collections, setCollections] = useState<CollectionRow[]>([])
  const [reports, setReports] = useState<SavedReport[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [circleRoster, setCircleRoster] = useState<CircleStudent[]>([])
  const [currentMonthValue, setCurrentMonthValue] = useState(currentMonth())
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | StudentStatus>('all')
  const [teacherFilter, setTeacherFilter] = useState<'all' | TeacherStatus>('all')
  const [studentModal, setStudentModal] = useState(false)
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [studentForm, setStudentForm] = useState<StudentForm>(blankStudent)
  const [teacherModal, setTeacherModal] = useState(false)
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null)
  const [teacherForm, setTeacherForm] = useState<TeacherForm>(blankTeacher)
  const [circleModal, setCircleModal] = useState(false)
  const [editingCircle, setEditingCircle] = useState<Circle | null>(null)
  const [circleForm, setCircleForm] = useState<CircleForm>(blankCircle)
  const [enrollmentModal, setEnrollmentModal] = useState(false)
  const [enrollmentForm, setEnrollmentForm] = useState<EnrollmentForm>(blankEnrollment())
  const [endingEnrollment, setEndingEnrollment] = useState<{ enrollmentId: string; studentId: string; studentName: string; circleId: string; circleName: string } | null>(null)
  const [endEnrollmentDate, setEndEnrollmentDate] = useState(localDateString())
  const [chargeModal, setChargeModal] = useState(false)
  const [editingChargeId, setEditingChargeId] = useState<string | null>(null)
  const [chargeForm, setChargeForm] = useState<ChargeForm>(blankCharge())
  const [paymentModal, setPaymentModal] = useState(false)
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(blankPayment())
  const [userModal, setUserModal] = useState(false)
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [userForm, setUserForm] = useState<UserForm>({ username: '', displayName: '', password: '', isActive: true, permissionCodes: [], scopeCircleIds: [], scopeTeacherIds: [] })
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null)
  const [selectedStudentPreview, setSelectedStudentPreview] = useState<{ id: string; fullName: string; studentCode: string } | null>(null)
  const [selectedTeacherDetails, setSelectedTeacherDetails] = useState<Teacher | null>(null)
  const [teacherHistory, setTeacherHistory] = useState<TeacherHistoryData | null>(null)
  const [teacherHistoryLoading, setTeacherHistoryLoading] = useState(false)
  const [teacherHistoryError, setTeacherHistoryError] = useState('')
  const [history, setHistory] = useState<HistoryData | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyNote, setHistoryNote] = useState('')
  const historyRequestRef = useRef(0)
  const teacherHistoryRequestRef = useRef(0)
  const circleRosterRequestRef = useRef(0)
  const [selectedCircle, setSelectedCircle] = useState<Circle | null>(null)
  const [circleDetailsLoading, setCircleDetailsLoading] = useState(false)
  const [reportView, setReportView] = useState<ReportSnapshot | null>(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Notice | null>(null)
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null)
  const [voidReason, setVoidReason] = useState('')

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('dar-theme', theme) }, [theme])
  useEffect(() => { document.title = branding.brandName + ' — لوحة الإدارة'; localStorage.setItem('dar-brand-name', branding.brandName) }, [branding.brandName])
  const {
    clockNow,
    setClockNow,
    notificationPermission,
    setNotificationPermission,
    scheduleNotificationsEnabled,
    toggleScheduleNotifications,
    notificationSound,
    setNotificationSound,
    notificationDuration,
    setNotificationDuration,
    previewNotificationSound,
    stopNotificationAudio: stopNotificationAudioNow,
    isScheduleAlertEnabled,
    setScheduleAlertEnabled,
    enableNotifications,
  } = useScheduleNotifications({ gate, scheduleSlots, setToast })
  const has = useCallback((code: string) => !!session?.permissionCodes.includes(code), [session])
  const canOpenPage = useCallback((id: Page, codes: string[]) => {
    if (id === 'dashboard') return codes.includes('dashboard.read')
    if (id === 'students') return ['students.read','students.create','students.edit','students.delete'].some(code => codes.includes(code))
    if (id === 'teachers') return ['teachers.read','teachers.create','teachers.edit','teachers.delete'].some(code => codes.includes(code))
    if (id === 'circles') return ['circles.read','circles.create','circles.edit','circles.delete'].some(code => codes.includes(code))
    if (id === 'schedule') return ['schedule.read','schedule.edit','attendance.read','attendance.edit'].some(code => codes.includes(code))
    if (id === 'payments') return ['finance.read','finance.create','finance.edit','finance.delete','finance.void'].some(code => codes.includes(code))
    if (id === 'meet') return ['meet.view','meet.manage','meet.calendar.manage','meet.media.view','meet.media.delete'].some(code => codes.includes(code))
    if (id === 'users') return codes.includes('users.manage')
    return ['settings.manage','audit.read','trash.manage','backup.manage','exports.manage'].some(code => codes.includes(code))
  }, [])
  const visiblePages = useMemo(() => navItems.filter(item => session && canOpenPage(item.id, session.permissionCodes)), [session, canOpenPage])
  const setFirstPage = useCallback((user: Session) => { setPage(navItems.find(item => canOpenPage(item.id, user.permissionCodes))?.id ?? 'dashboard') }, [canOpenPage])
  useEffect(() => {
    if (gate === 'ready' && session && visiblePages.length > 0 && !visiblePages.some(item => item.id === page)) setPage(visiblePages[0].id)
  }, [gate, session, page, visiblePages])

  const {
    checkHealth, loadStudents, loadTeachers, loadCircles, loadScheduleSlots, loadAttendance,
    loadAdvertisingExpenses, loadOperatingExpenses, loadCollections, loadReports, loadUsers, refreshAll,
  } = useDarDataLoaders({
    session, currentMonthValue, busy, setBusy, setToast, setHealth,
    setStudents, setTeachers, setCircles, setScheduleSlots, setAttendanceRows, setStudentAttendanceSummaries,
    setAdvertisingExpenses, setOperatingExpenses, setCollections, setReports, setUsers, setPermissions,
  })

  const clearSessionData = () => {
    setStudents([]); setTeachers([]); setCircles([]); setScheduleSlots([]); setAttendanceRows([])
    setStudentAttendanceSummaries([]); setAdvertisingExpenses([]); setOperatingExpenses([])
    setCollections([]); setReports([]); setUsers([]); setPermissions([]); setCircleRoster([])
    circleRosterRequestRef.current += 1
    setSelectedTeacherDetails(null); setTeacherHistory(null); setTeacherHistoryLoading(false); setTeacherHistoryError('')
    setSelectedCircle(null); setCircleDetailsLoading(false); setReportView(null)
  }
  const { setup, setSetup, login, setLogin, doSetup, doLogin, quickLogin, logout } = useDarAuth({
    setSession, setFirstPage, setGate, setPage, setSaving, setToast, setBranding,
    setHistory, setSelectedStudent, setSelectedStudentPreview, onSessionCleared: clearSessionData,
  })
  useEffect(() => { if (gate === 'ready' && session) void refreshAll() }, [gate, session?.id])
  useEffect(() => { if (gate !== 'ready' || !session) return; if (has('finance.read')) { void loadCollections(currentMonthValue); void loadAdvertisingExpenses(currentMonthValue); void loadOperatingExpenses(currentMonthValue); if (page === 'payments') void loadReports(currentMonthValue) } }, [gate, session?.id, page, currentMonthValue, has, loadCollections, loadReports, loadAdvertisingExpenses, loadOperatingExpenses])
  useEffect(() => { if (gate !== 'ready' || !session) return; if (page === 'schedule' && (has('schedule.read')||has('schedule.edit')||has('attendance.read')||has('attendance.edit'))) void loadScheduleSlots(); if (has('attendance.read')||has('attendance.edit')) void loadAttendance(currentMonthValue) }, [gate, session?.id, page, currentMonthValue, has, loadScheduleSlots, loadAttendance])
  useEffect(() => { if (paymentReceiptPreview) return () => URL.revokeObjectURL(paymentReceiptPreview) }, [paymentReceiptPreview])

  const moveRecordToTrash = async (entityType: string, entityId: string, displayName: string) => {
    if (!has('trash.manage')) { setToast({tone:'error',text:'لا يمكن حذف السجل من هذا الحساب. اطلب صلاحية إدارة سلة المهملات من المدير.'}); return false }
    if (!(await confirmAction({ title: 'نقل إلى سلة المهملات', message: `نقل «${displayName}» إلى سلة المهملات؟ يمكنك استعادته قبل انتهاء مدة الاحتفاظ.`, confirmLabel: 'متابعة' }))) return false
    try { await request('/api/admin/trash', { method: 'POST', body: JSON.stringify({ entityType, entityId }) }); setToast({tone:'success',text:`تم نقل «${displayName}» إلى سلة المهملات.`}); return true }
    catch (error) { setToast({tone:'error',text:error instanceof Error ? error.message : 'تعذر نقل السجل إلى سلة المهملات.'}); return false }
  }

  const closeDetailLayers = () => { historyRequestRef.current += 1; teacherHistoryRequestRef.current += 1; circleRosterRequestRef.current += 1; setHistory(null); setSelectedStudent(null); setSelectedStudentPreview(null); setHistoryLoading(false); setSelectedTeacherDetails(null); setTeacherHistory(null); setTeacherHistoryLoading(false); setTeacherHistoryError(''); setSelectedCircle(null); setCircleRoster([]); setReportView(null) }
  const { openUserCreate, openUserEdit, saveUser, deactivateUser } = useUserActions({
    userForm, editingUser, setEditingUser, setUserForm, setUserModal, setSaving, setToast,
    closeDetailLayers, loadUsers,
  })
  const {
    openStudentCreate, duplicateStudent, openStudentEdit, saveStudent, changeStudentStatus, deleteStudent,
    openHistory, closeHistory, addStudentNote, deleteStudentNote,
  } = useStudentActions({
    has, setToast, setSaving, closeDetailLayers, moveRecordToTrash, students, selectedStudent, history, historyNote,
    setHistoryNote, editingStudent, studentForm, setEditingStudent, setStudentForm, setStudentModal, setTeacherModal,
    setCircleModal, setEnrollmentModal, setPaymentModal, setChargeModal, setUserModal, setHistory, setHistoryLoading,
    setSelectedStudent, setSelectedStudentPreview, setSelectedCircle, setReportView, setSelectedTeacherDetails,
    setTeacherHistory, setTeacherHistoryLoading, setTeacherHistoryError, historyRequestRef, teacherHistoryRequestRef,
    loadStudents, loadCircles, loadCollections,
  })
  const {
    openTeacherDetails, closeTeacherDetails, addTeacherNote, deleteTeacherNote,
    openTeacherCreate, openTeacherEdit, saveTeacher, deleteTeacher,
  } = useTeacherActions({
    has, setToast, setSaving, closeDetailLayers, moveRecordToTrash, teacherHistory, selectedTeacherDetails,
    editingTeacher, teacherForm, setEditingTeacher, setTeacherForm, setTeacherModal, setStudentModal, setCircleModal,
    setEnrollmentModal, setPaymentModal, setChargeModal, setUserModal, setSelectedTeacherDetails, setTeacherHistory,
    setTeacherHistoryLoading, setTeacherHistoryError, teacherHistoryRequestRef, loadTeachers, loadCircles,
  })

  const { openCircleCreate, openCircleEdit, saveCircle, deleteCircle, openCircleDetails } = useCircleActions({
    has, setToast, setSaving, closeDetailLayers, moveRecordToTrash, editingCircle, circleForm, scheduleSlots, selectedCircle,
    setEditingCircle, setCircleForm, setCircleModal, setStudentModal, setTeacherModal, setEnrollmentModal, setPaymentModal,
    setChargeModal, setUserModal, setSelectedCircle, setCircleDetailsLoading, setCircleRoster, setPage, setHistory,
    setHistoryLoading, setSelectedStudent, setSelectedStudentPreview, setSelectedTeacherDetails, setTeacherHistory,
    setTeacherHistoryLoading, setTeacherHistoryError, setReportView, historyRequestRef, teacherHistoryRequestRef, circleRosterRequestRef,
    loadCircles, loadTeachers, loadScheduleSlots, loadAttendance, loadAdvertisingExpenses, loadOperatingExpenses,
  })

  const saveScheduleSlot = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); try { await request('/api/schedule-slots', { method: 'POST', body: JSON.stringify({ circleId: scheduleForm.circleId, dayOfWeek: Number(scheduleForm.dayOfWeek), startsAt: scheduleForm.startsAt, durationMinutes: Number(scheduleForm.durationMinutes) }) }); await Promise.all([loadScheduleSlots(), loadAttendance()]); setToast({ tone: 'success', text: 'تم حفظ الموعد الأسبوعي وتحديث الحصص المتوقعة وكشف الحضور.' }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ موعد الحلقة.' }) } finally { setSaving(false) } }
  const removeScheduleSlot = async (slot: ScheduleSlot) => { if (!await moveRecordToTrash('schedule-slot', slot.id, `${slot.circleName} · ${weekDays[slot.dayOfWeek]} ${formatTime12(slot.startsAt)}`)) return; await Promise.all([loadScheduleSlots(), loadAttendance()]) }
  const markAttendance = async (slot: ScheduleSlot, date: string, status: AttendanceRow['status'], substituteTeacherId?: string) => { const label = status === 'present' ? 'حضور' : status === 'absent' ? 'غياب' : 'إلغاء الحصة'; const selectedTeacher = substituteTeacherId ? teachers.find(item => item.id === substituteTeacherId) : undefined; const teacherName = selectedTeacher?.fullName ?? slot.teacherName; const substituteMessage = selectedTeacher && selectedTeacher.id !== slot.teacherId ? ` كبديلة عن ${slot.teacherName}` : ''; if (!(await confirmAction({ title: 'تأكيد تسجيل الحضور', message: `تسجيل ${label} للمعلمة ${teacherName}${substituteMessage} في حلقة ${slot.circleName} يوم ${formatDate(date)}؟`, confirmLabel: 'متابعة' }))) return false; try { const saved = await request<{payableAmount:number|null;hourlyRateSnapshot:number|null;teacherName?:string;isSubstitute?:boolean}>('/api/teacher-attendance', { method: 'POST', body: JSON.stringify({ scheduleSlotId: slot.id, sessionDate: date, status, note: null, teacherId: substituteTeacherId ?? null }) }); await loadAttendance(); setToast({ tone: 'success', text: status === 'present' ? (has('finance.read') ? `تم تسجيل حضور ${saved.teacherName ?? teacherName}. المستحق لهذه الحصة ${money(saved.payableAmount)} (أجر الساعة المحفوظ ${money(saved.hourlyRateSnapshot)}).` : `تم تسجيل حضور ${saved.teacherName ?? teacherName} بنجاح.`) : `تم تسجيل ${label} ولن تُحتسب أجرة لهذه الحصة.` }); return true } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تسجيل الحضور.' }); return false } }
  const updateAttendanceDuration = async (attendanceId: string, durationMinutes: number) => { if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 360) { setToast({ tone: 'error', text: 'مدة الحصة يجب أن تكون بين 15 و360 دقيقة.' }); return }; try { const saved = await request<{ durationMinutes: number; payableAmount: number | null; status: string }>(`/api/teacher-attendance/${attendanceId}/duration`, { method: 'PUT', body: JSON.stringify({ durationMinutes }) }); await loadAttendance(); setToast({ tone: 'success', text: has('finance.read') ? `تم تعديل مدة الحضور إلى ${saved.durationMinutes} دقيقة وإعادة حساب المستحق إلى ${money(saved.payableAmount)}.` : `تم تعديل مدة الحضور إلى ${saved.durationMinutes} دقيقة بنجاح.` }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تعديل مدة الحضور.' }) } }
  const saveAdExpense = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); try { await request('/api/advertising-expenses', { method: 'POST', body: JSON.stringify({ circleId: adExpenseForm.circleId, platform: adExpenseForm.platform.trim() || null, startDate: adExpenseForm.startDate, daysCount: Number(adExpenseForm.daysCount), dailyCost: Number(adExpenseForm.dailyCost), note: adExpenseForm.note.trim() || null }) }); setAdExpenseForm(blankAdExpense()); await loadAdvertisingExpenses(); setToast({ tone: 'success', text: 'تم حفظ مصروف الإعلان وربطه بالحلقة.' }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ مصروف الإعلان.' }) } finally { setSaving(false) } }
  const deleteAdExpense = async (ad: AdExpense) => { if (!await moveRecordToTrash('advertising-expense', ad.id, `إعلان ${ad.circleName}`)) return; await loadAdvertisingExpenses() }
  const nextSessions = useMemo(() => getNextSessions(scheduleSlots, circles, clockNow), [scheduleSlots, circles, clockNow])
  const monthSessions = useMemo(() => getMonthSessions(scheduleSlots, attendanceRows, currentMonthValue), [scheduleSlots, attendanceRows, currentMonthValue])
  const monthlyTeacherPay = useMemo(() => getMonthlyTeacherPay(attendanceRows), [attendanceRows])

  const openEnrollmentCreate = (studentId = '', circleId = '', fee: number | null = 0) => { setHistory(null); setSelectedStudent(null); setSelectedCircle(null); setEnrollmentForm(blankEnrollment(studentId, circleId, fee)); setEnrollmentModal(true) }
  const saveEnrollment = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); try { const canEditFinancials = has('finance.read') && has('finance.edit'); const payload = { studentId: enrollmentForm.studentId, circleId: enrollmentForm.circleId, startsOn: enrollmentForm.startsOn, ...(canEditFinancials ? { agreedMonthlyFee: Number(enrollmentForm.agreedMonthlyFee) } : {}), allowClosedCircle: Boolean(enrollmentForm.allowClosedCircle) }; await request('/api/enrollments', { method: 'POST', body: JSON.stringify(payload) }); setEnrollmentModal(false); await Promise.all([loadStudents(), loadCircles(), loadCollections()]); if (selectedStudent) await openHistory(selectedStudent.id); if (selectedCircle) await openCircleDetails(selectedCircle); setToast({ tone: 'success', text: 'تم إلحاق الطالب بالحلقة وحفظ تاريخ الالتحاق.' }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تسجيل الالتحاق.' }) } finally { setSaving(false) } }
  const endEnrollment = async (enrollmentId: string, studentId: string, studentName = 'الطالب', circleName = 'الحلقة', circleId = selectedCircle?.id ?? '') => { setEndEnrollmentDate(localDateString()); setEndingEnrollment({ enrollmentId, studentId, studentName, circleId, circleName }) }
  const refreshEnrollmentViews = async (circleId: string, studentId?: string) => {
    await Promise.all([loadStudents(), loadCircles(), loadCollections()])
    if (studentId && selectedStudent?.id === studentId && history) {
      await openHistory(studentId)
      return
    }
    const circle = selectedCircle?.id === circleId ? selectedCircle : circles.find(item => item.id === circleId) ?? selectedCircle
    if (circle) await openCircleDetails(circle)
  }
  const pauseEnrollment = async (enrollmentId: string, studentId: string, studentName: string, circleName: string, circleId = selectedCircle?.id ?? '') => {
    if (!(await confirmAction({ title: 'تأكيد تسجيل الحضور', message: `سيتم إيقاف التحاق ${studentName} في حلقة ${circleName} اعتبارًا من اليوم فقط. لن تتأثر التحاقاته في الحلقات الأخرى، وسيُمنع تسجيل حضور جديد لهذا الالتحاق خلال فترة الإيقاف. هل تريد المتابعة؟`, confirmLabel: 'متابعة' }))) return
    setSaving(true)
    try {
      await request(`/api/enrollments/${enrollmentId}/pause`, { method: 'PATCH', body: JSON.stringify({ effectiveOn: localDateString(), reason: null }) })
      await refreshEnrollmentViews(circleId, studentId)
      setToast({ tone: 'success', text: `تم إيقاف التحاق ${studentName} في ${circleName} مؤقتًا.` })
    } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر إيقاف الالتحاق.' }) }
    finally { setSaving(false) }
  }
  const resumeEnrollment = async (enrollmentId: string, studentId: string, studentName: string, circleName: string, circleId = selectedCircle?.id ?? '') => {
    if (!(await confirmAction({ title: 'تأكيد العملية', message: `سيُستأنف التحاق ${studentName} في حلقة ${circleName} اعتبارًا من اليوم. لن تتأثر حالة التحاقه في الحلقات الأخرى. هل تريد المتابعة؟`, confirmLabel: 'متابعة' }))) return
    setSaving(true)
    try {
      await request(`/api/enrollments/${enrollmentId}/resume`, { method: 'PATCH', body: JSON.stringify({ effectiveOn: localDateString(), reason: null }) })
      await refreshEnrollmentViews(circleId, studentId)
      setToast({ tone: 'success', text: `تم استئناف التحاق ${studentName} في ${circleName}.` })
    } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر استئناف الالتحاق.' }) }
    finally { setSaving(false) }
  }
  const confirmEndEnrollment = async () => {
    if (!endingEnrollment) return
    if (!endEnrollmentDate || endEnrollmentDate > localDateString()) { setToast({ tone: 'error', text: 'اختَر تاريخ نهاية مسجلًا اليوم أو قبله.' }); return }
    setSaving(true)
    const ending = endingEnrollment
    try {
      await request(`/api/enrollments/${ending.enrollmentId}/end`, { method: 'PATCH', body: JSON.stringify({ endsOn: endEnrollmentDate }) })
      setEndingEnrollment(null)
      await Promise.all([loadStudents(), loadCircles(), loadCollections()])
      if (selectedStudent?.id === ending.studentId && history) await openHistory(ending.studentId)
      else {
        const circle = selectedCircle?.id === ending.circleId ? selectedCircle : circles.find(item => item.id === ending.circleId)
        if (circle) await openCircleDetails(circle)
      }
      setToast({ tone: 'success', text: `تم إنهاء التحاق ${ending.studentName} بتاريخ ${formatDate(endEnrollmentDate)} مع الاحتفاظ بالتاريخ والتحصيلات السابقة.` })
    } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر إنهاء الالتحاق.' }) }
    finally { setSaving(false) }
  }

  const openChargeCreate = (row: CollectionRow) => { closeDetailLayers(); setEditingChargeId(null); setChargeForm(blankCharge(row.enrollmentId, currentMonthValue, getSuggestedMonthlyCharge(row))); setChargeModal(true) }
  const saveCharge = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); try { if (editingChargeId) await request(`/api/charges/${editingChargeId}`, { method: 'PUT', body: JSON.stringify({ amountDue: Number(chargeForm.amountDue), note: chargeForm.note.trim() || null }) }); else await request('/api/charges', { method: 'POST', body: JSON.stringify({ ...chargeForm, amountDue: Number(chargeForm.amountDue) }) }); setChargeModal(false); setEditingChargeId(null); await loadCollections(); setToast({ tone: 'success', text: editingChargeId ? 'تم تعديل الاستحقاق.' : 'تم تسجيل استحقاق الشهر للحلقة والطالب.' }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ الاستحقاق.' }) } finally { setSaving(false) } }
  const openVoidCharge = (chargeId: string, label: string, studentId?: string) => {
    if (!has(FINANCE_VOID_PERMISSION)) { setToast({ tone: 'error', text: 'إلغاء سجل مالي يحتاج صلاحية إلغاء السجلات المالية (finance.void). اطلبها من المدير.' }); return }
    setVoidReason('')
    setVoidTarget({ kind: 'charge', id: chargeId, label, studentId })
  }
  const openVoidPayment = (paymentId: string, label: string, studentId?: string) => {
    if (!has(FINANCE_VOID_PERMISSION)) { setToast({ tone: 'error', text: 'إلغاء سجل مالي يحتاج صلاحية إلغاء السجلات المالية (finance.void). اطلبها من المدير.' }); return }
    setVoidReason('')
    setVoidTarget({ kind: 'payment', id: paymentId, label, studentId })
  }
  const closeVoidDialog = () => { if (saving) return; setVoidTarget(null); setVoidReason('') }
  const submitVoid = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!voidTarget) return
    const reason = voidReason.trim()
    if (reason.length < VOID_REASON_MIN_LENGTH || reason.length > VOID_REASON_MAX_LENGTH) { setToast({ tone: 'error', text: 'سبب الإلغاء يجب أن يكون بين 3 و500 حرف.' }); return }
    const target = voidTarget
    setSaving(true)
    try {
      await request('/api/' + (target.kind === 'charge' ? 'charges' : 'payments') + '/' + target.id + '/void', { method: 'POST', body: JSON.stringify({ reason }) })
      setVoidTarget(null)
      setVoidReason('')
      await Promise.all([loadCollections(), loadStudents()])
      if (target.studentId && history?.student.id === target.studentId) await openHistory(target.studentId)
      setToast({ tone: 'success', text: target.kind === 'charge' ? 'تم إلغاء الاستحقاق (Void) مع الاحتفاظ بالسجل وسبب الإلغاء.' : 'تم إلغاء حركة التحصيل (Void) مع الاحتفاظ بالسجل وإعادة احتساب المتبقي.' })
    } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر إلغاء السجل المالي.' }) }
    finally { setSaving(false) }
  }
  const deleteReport = async (report: SavedReport) => { if (!await moveRecordToTrash('collection-report', report.id, report.title)) return; await loadReports() }

  const openPaymentCreate = (row: CollectionRow) => { if (!row.chargeId) return; closeDetailLayers(); setPaymentForm(blankPayment(row.chargeId, row.balance)); setPaymentModal(true) }
  const savePayment = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); try { const data = { ...paymentForm, amount: Number(paymentForm.amount), paidAt: new Date().toISOString(), method: paymentForm.method || null, reference: paymentForm.reference.trim() || null, note: paymentForm.note.trim() || null }; if (paymentReceipt) { const form = new FormData(); Object.entries(data).forEach(([key,value])=>form.append(key, value == null ? '' : String(value))); form.append('receipt',paymentReceipt); await requestForm('/api/payments/with-receipt',form) } else { await request('/api/payments', { method: 'POST', body: JSON.stringify(data) }) } setPaymentModal(false); setPaymentReceipt(null); setPaymentReceiptPreview(null); await Promise.all([loadCollections(), loadStudents()]); if (selectedStudent) await openHistory(selectedStudent.id); setToast({ tone: 'success', text: paymentReceipt ? 'تم تسجيل التحصيل وحفظ صورة الإيصال داخل قاعدة البيانات.' : 'تم تسجيل مبلغ التحصيل.' }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تسجيل التحصيل.' }) } finally { setSaving(false) } }

  const createReport = async () => { setSaving(true); try { await request('/api/collection-reports', { method: 'POST', body: JSON.stringify({ billingMonth: currentMonthValue, title: `تقرير تحصيل ${currentMonthValue}` }) }); await loadReports(); setToast({ tone: 'success', text: 'تم حفظ نسخة ثابتة من تقرير التحصيل في النظام.' }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ التقرير.' }) } finally { setSaving(false) } }
  const openSavedReport = async (report: SavedReport) => { try { setReportView(await request<ReportSnapshot>(`/api/collection-reports/${report.id}`)) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر فتح التقرير المحفوظ.' }) } }
  const downloadCollectionSvg = () => safeDownload(`تحصيل-${currentMonthValue}.svg`, makeReportSvg('تقرير الاشتراكات والتحصيل', currentMonthValue, collections, { due: collections.reduce((s,r)=>s+r.amountDue,0), paid: collections.reduce((s,r)=>s+r.paidAmount,0), balance: collections.reduce((s,r)=>s+r.balance,0) }), 'image/svg+xml;charset=utf-8')
  const downloadSavedCsv = (report: ReportSnapshot) => safeDownload(`تحصيل-${report.billingMonth.slice(0,7)}.csv`, toCsv(report.snapshot.rows), 'text/csv;charset=utf-8')
  const downloadSavedJson = (report: ReportSnapshot) => safeDownload(`تحصيل-${report.billingMonth.slice(0,7)}.json`, JSON.stringify(report.snapshot,null,2), 'application/json;charset=utf-8')

  const resetOperatingExpenseForm = () => { setOperatingExpenseForm(blankOperatingExpense()); setEditingOperatingExpenseId(null) }
  const editOperatingExpense = (expense: OperatingExpense) => { setEditingOperatingExpenseId(expense.id); setOperatingExpenseForm({ expenseDate: expense.expenseDate.slice(0,10), category: expense.category, description: expense.description, amount: String(expense.amount), circleId: expense.circleId ?? '', note: expense.note ?? '' }) }
  const saveOperatingExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amount = Number(operatingExpenseForm.amount)
    if (!Number.isFinite(amount) || amount <= 0) { setToast({ tone: 'error', text: 'اكتب مبلغ مصروف أكبر من صفر.' }); return }
    setSaving(true)
    const wasEditing = !!editingOperatingExpenseId
    try {
      const payload = { expenseDate: operatingExpenseForm.expenseDate, category: operatingExpenseForm.category.trim(), description: operatingExpenseForm.description.trim(), amount, circleId: operatingExpenseForm.circleId || null, note: operatingExpenseForm.note.trim() || null }
      await request(editingOperatingExpenseId ? `/api/operating-expenses/${editingOperatingExpenseId}` : '/api/operating-expenses', { method: editingOperatingExpenseId ? 'PUT' : 'POST', body: JSON.stringify(payload) })
      resetOperatingExpenseForm()
      const expenseMonth = payload.expenseDate.slice(0, 7)
      if (expenseMonth !== currentMonthValue) setCurrentMonthValue(expenseMonth)
      await loadOperatingExpenses(expenseMonth)
      setToast({ tone: 'success', text: wasEditing ? 'تم تحديث المصروف التشغيلي.' : 'تم تسجيل المصروف التشغيلي.' })
    } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ المصروف التشغيلي.' }) }
    finally { setSaving(false) }
  }
  const deleteOperatingExpense = async (expense: OperatingExpense) => { if (!await moveRecordToTrash('operating-expense', expense.id, expense.description)) return; await loadOperatingExpenses() }

  const filteredStudents = useMemo(() => getFilteredStudents(students, query, statusFilter), [students, query, statusFilter])
  const filteredTeachers = useMemo(() => getFilteredTeachers(teachers, query, teacherFilter), [teachers, query, teacherFilter])
  const currentTitle = navItems.find(item=>item.id===page)?.label ?? 'لوحة التحكم'
  const currentMonthTotals = useMemo(() => getCurrentMonthTotals(collections), [collections])
  const monthlyTeacherPayTotal = useMemo(() => getMonthlyTeacherPayTotal(attendanceRows), [attendanceRows])
  const monthlyAdvertisingTotal = useMemo(() => getMonthlyAdvertisingTotal(advertisingExpenses), [advertisingExpenses])
  const monthlyOperatingExpenseTotal = useMemo(() => getMonthlyOperatingExpenseTotal(operatingExpenses), [operatingExpenses])
  const dashboardProfit = useMemo(() => getDashboardProfit({ currentMonthTotals, monthlyAdvertisingTotal, monthlyTeacherPayTotal, monthlyOperatingExpenseTotal, collections, monthSessions, clockNow }), [currentMonthTotals, monthlyAdvertisingTotal, monthlyTeacherPayTotal, monthlyOperatingExpenseTotal, collections, monthSessions, clockNow])
  const teacherPaySummary = useMemo(() => getTeacherPaySummary(attendanceRows), [attendanceRows])
  const circleProfitSummary = useMemo(() => getCircleProfitSummary({ circles, collections, advertisingExpenses, attendanceRows, operatingExpenses }), [circles, collections, advertisingExpenses, attendanceRows, operatingExpenses])
  const downloadProfitSummary = () => exportProfitSummary({ brandName: branding.brandName, currentMonthValue, dashboardProfit, teacherPaySummary, circleProfitSummary })
  const changePage = (next: Page) => { if (!visiblePages.some(item=>item.id===next)) { setToast({tone:'error',text:'حسابك لا يملك صلاحية فتح القسم المطلوب.'}); return }; setPage(next); if(next==='students'&&has('students.read'))void loadStudents();if(next==='teachers'&&has('teachers.read'))void loadTeachers();if(next==='circles'&&has('circles.read'))void loadCircles();if(next==='schedule'){if(has('schedule.read')||has('schedule.edit')||has('attendance.read')||has('attendance.edit'))void loadScheduleSlots();if(has('attendance.read')||has('attendance.edit'))void loadAttendance()}if(next==='payments'&&has('finance.read')){void loadCollections();void loadReports();void loadAdvertisingExpenses()}if(next==='users')void loadUsers() }

  const notifySystem = useCallback((tone: 'success' | 'error' | 'info', text: string) => setToast({ tone, text }), [])
  const saveBranding = (next: Branding) => { setBranding(next); localStorage.setItem('dar-brand-name', next.brandName) }
  const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { setToast({tone:'error',text:'اختَر صورة PNG أو JPG أو WebP لا يتجاوز حجمها 2 ميجابايت.'}); return }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('تعذرت قراءة الصورة.')); reader.onerror = () => reject(new Error('تعذرت قراءة الصورة.')); reader.readAsDataURL(file) })
      await request('/api/auth/profile/avatar', { method: 'PUT', body: JSON.stringify({ dataUrl }) })
      setAvatarAvailable(true); setAvatarVersion(Date.now()); setToast({tone:'success',text:'تم حفظ صورة الحساب.'})
    } catch (error) { setToast({tone:'error',text:error instanceof Error ? error.message : 'تعذر حفظ الصورة.'}) }
  }

  
  return {
    theme, setTheme, gate, setGate, branding, setBranding,
    avatarVersion, setAvatarVersion, avatarAvailable, setAvatarAvailable, avatarInputRef,
    session, setSession, setup, setSetup, login, setLogin, page, setPage, health, setHealth,
    students, setStudents, teachers, setTeachers, circles, setCircles,
    scheduleSlots, setScheduleSlots, attendanceRows, studentAttendanceSummaries, setAttendanceRows,
    advertisingExpenses, setAdvertisingExpenses, operatingExpenses, setOperatingExpenses,
    operatingExpenseForm, setOperatingExpenseForm, editingOperatingExpenseId, setEditingOperatingExpenseId,
    clockNow, setClockNow, notificationPermission, setNotificationPermission,
    scheduleNotificationsEnabled, toggleScheduleNotifications, notificationSound, setNotificationSound,
    notificationDuration, setNotificationDuration, previewNotificationSound,
    stopNotificationAudio: stopNotificationAudioNow, isScheduleAlertEnabled, setScheduleAlertEnabled,
    scheduleForm, setScheduleForm, adExpenseForm, setAdExpenseForm,
    paymentReceipt, setPaymentReceipt, paymentReceiptPreview, setPaymentReceiptPreview,
    collections, setCollections, reports, setReports, users, setUsers, permissions, setPermissions,
    circleRoster, setCircleRoster, currentMonthValue, setCurrentMonthValue, query, setQuery,
    statusFilter, setStatusFilter, teacherFilter, setTeacherFilter,
    studentModal, setStudentModal, editingStudent, setEditingStudent, studentForm, setStudentForm,
    teacherModal, setTeacherModal, editingTeacher, setEditingTeacher, teacherForm, setTeacherForm,
    circleModal, setCircleModal, editingCircle, setEditingCircle, circleForm, setCircleForm,
    enrollmentModal, setEnrollmentModal, enrollmentForm, setEnrollmentForm,
    endingEnrollment, setEndingEnrollment, endEnrollmentDate, setEndEnrollmentDate, confirmEndEnrollment,
    chargeModal, setChargeModal, editingChargeId, setEditingChargeId, chargeForm, setChargeForm,
    paymentModal, setPaymentModal, paymentForm, setPaymentForm,
    userModal, setUserModal, editingUser, setEditingUser, userForm, setUserForm,
    selectedStudent, selectedStudentPreview, setSelectedStudent,
    selectedTeacherDetails, teacherHistory, teacherHistoryLoading, teacherHistoryError,
    history, setHistory, historyLoading, setHistoryLoading, historyNote, setHistoryNote,
    selectedCircle, setSelectedCircle, circleDetailsLoading, setCircleDetailsLoading,
    reportView, setReportView, saving, setSaving, busy, setBusy, toast, setToast,
    has, canOpenPage, visiblePages, setFirstPage,
    checkHealth, loadStudents, loadTeachers, loadCircles, loadScheduleSlots, loadAttendance,
    loadAdvertisingExpenses, loadOperatingExpenses, loadCollections, loadReports, loadUsers, refreshAll,
    doSetup, doLogin, quickLogin, logout, moveRecordToTrash, closeDetailLayers,
    openStudentCreate, duplicateStudent, openStudentEdit, saveStudent, changeStudentStatus, deleteStudent,
    openHistory, closeHistory, openTeacherDetails, closeTeacherDetails,
    addStudentNote, deleteStudentNote, addTeacherNote, deleteTeacherNote,
    openTeacherCreate, openTeacherEdit, saveTeacher, deleteTeacher,
    openCircleCreate, openCircleEdit, saveCircle, deleteCircle, openCircleDetails,
    saveScheduleSlot, removeScheduleSlot, markAttendance, updateAttendanceDuration,
    saveAdExpense, deleteAdExpense, enableNotifications, nextSessions, monthSessions, monthlyTeacherPay,
    openEnrollmentCreate, saveEnrollment, endEnrollment, pauseEnrollment, resumeEnrollment,
    openChargeCreate, saveCharge, deleteReport,
    openPaymentCreate, savePayment, createReport, openSavedReport,
    voidTarget, setVoidTarget, voidReason, setVoidReason, openVoidCharge, openVoidPayment, submitVoid, closeVoidDialog,
    downloadCollectionSvg, downloadSavedCsv, downloadSavedJson,
    resetOperatingExpenseForm, editOperatingExpense, saveOperatingExpense, deleteOperatingExpense,
    openUserCreate, openUserEdit, saveUser, deactivateUser,
    filteredStudents, filteredTeachers, currentTitle, currentMonthTotals, monthlyTeacherPayTotal,
    monthlyAdvertisingTotal, monthlyOperatingExpenseTotal, dashboardProfit, teacherPaySummary,
    circleProfitSummary, downloadProfitSummary, changePage, notifySystem, saveBranding, uploadAvatar
  }
}

export type DarApplicationContext = ReturnType<typeof useDarApplication>