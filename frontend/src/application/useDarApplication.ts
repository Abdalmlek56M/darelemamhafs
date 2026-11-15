import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import type { Theme, Branding, Page, Gate, StudentStatus, TeacherStatus, Session, Student, Teacher, Circle, CollectionRow, Permission, AdminUser, SavedReport, HistoryData, CircleStudent, Notice, StudentForm, TeacherForm, CircleForm, CircleScheduleDraft, EnrollmentForm, ChargeForm, PaymentForm, UserForm, ReportSnapshot, ScheduleSlot, AttendanceRow, AdExpense, AdExpenseForm, OperatingExpense, OperatingExpenseForm, CircleProfitSummary, TeacherPaySummary, TeacherHistoryData, StudentAttendanceSummary } from '../domain/types'
import { defaultBranding, weekDays, blankAdExpense, blankOperatingExpense, blankStudent, blankTeacher, blankCircle, blankEnrollment, blankCharge, blankPayment } from '../domain/defaults'
import { statusLabels } from '../domain/labels'
import { localDateString, localDateKey, currentMonth, timeLabel, remainingLabel, sessionDateTime } from '../lib/dates'
import { formatDate, money } from '../lib/formatters'
import { safeDownload, toCsv, makeReportSvg } from '../lib/reportExports'
import { request, requestForm } from '../services/apiClient'
import { saveDesktopCredential } from '../services/desktopCredentialBridge'
import { navItems } from '../domain/navigation'
import { playNotificationSound, readNotificationSound, saveNotificationSound, readNotificationDuration, saveNotificationDuration, stopNotificationSound as stopNotificationAudio, type NotificationSound, type NotificationDuration } from '../lib/notificationSounds'
import {
  getNextSessions,
  getMonthSessions,
  getMonthlyTeacherPay,
  getSuggestedFirstMonthCharge as suggestedFirstMonthCharge,
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

export default function useDarApplication() {

  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('dar-theme') as Theme) || 'dark')
  const [gate, setGate] = useState<Gate>('checking')
  const [branding, setBranding] = useState<Branding>(() => ({ ...defaultBranding, brandName: localStorage.getItem('dar-brand-name') || defaultBranding.brandName }))
  const [avatarVersion, setAvatarVersion] = useState(0)
  const [avatarAvailable, setAvatarAvailable] = useState(true)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [setup, setSetup] = useState({ username: 'admin', displayName: 'مدير الدار', password: '', confirmPassword: '' })
  const [login, setLogin] = useState({ username: '', password: '', rememberMe: false })
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
  const [clockNow, setClockNow] = useState(Date.now())
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => typeof Notification === 'undefined' ? 'denied' : Notification.permission)
  const [scheduleNotificationsEnabled, setScheduleNotificationsEnabled] = useState<boolean>(() => { try { return localStorage.getItem('dar-schedule-notifications-enabled') !== 'false' } catch { return true } })
  const [notificationSound, setNotificationSound] = useState<NotificationSound>(() => readNotificationSound())
  const [notificationDuration, setNotificationDuration] = useState<NotificationDuration>(() => readNotificationDuration())
  const [disabledScheduleAlerts, setDisabledScheduleAlerts] = useState<string[]>(() => { try { const parsed = JSON.parse(localStorage.getItem('dar-disabled-class-alerts') || '[]'); return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [] } catch { return [] } })
  const firedClassAlertsRef = useRef<Set<string>>(new Set())
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
  const [userForm, setUserForm] = useState<UserForm>({ username: '', displayName: '', password: '', isActive: true, permissionCodes: [] })
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
  const [selectedCircle, setSelectedCircle] = useState<Circle | null>(null)
  const [circleDetailsLoading, setCircleDetailsLoading] = useState(false)
  const [reportView, setReportView] = useState<ReportSnapshot | null>(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Notice | null>(null)

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('dar-theme', theme) }, [theme])
  useEffect(() => { document.title = branding.brandName + ' — لوحة الإدارة'; localStorage.setItem('dar-brand-name', branding.brandName) }, [branding.brandName])
  useEffect(() => { saveNotificationSound(notificationSound) }, [notificationSound])
  useEffect(() => { saveNotificationDuration(notificationDuration) }, [notificationDuration])
  useEffect(() => { try { localStorage.setItem('dar-schedule-notifications-enabled', String(scheduleNotificationsEnabled)) } catch { /* Local reminder toggle is a device preference. */ } }, [scheduleNotificationsEnabled])
  useEffect(() => { try { localStorage.setItem('dar-disabled-class-alerts', JSON.stringify(disabledScheduleAlerts)) } catch { /* Alert preferences are local-only convenience settings. */ } }, [disabledScheduleAlerts])
  const isScheduleAlertEnabled = useCallback((slotId: string) => !disabledScheduleAlerts.includes(slotId), [disabledScheduleAlerts])
  const setScheduleAlertEnabled = useCallback((slotId: string, enabled: boolean) => {
    setDisabledScheduleAlerts(current => enabled ? current.filter(id => id !== slotId) : (current.includes(slotId) ? current : [...current, slotId]))
  }, [])
  const previewNotificationSound = useCallback(() => {
    const played = playNotificationSound(notificationSound, notificationDuration)
    setToast({ tone: played ? 'success' : 'info', text: played ? `تم تشغيل عينة الصوت لمدة ${notificationDuration} ${notificationDuration === 10 ? 'ثوانٍ' : 'ثانية'}.` : 'تعذر تشغيل الصوت. جرّب الضغط على زر المعاينة مرة أخرى وتأكد من مستوى الصوت.' })
  }, [notificationSound, notificationDuration])
  const stopNotificationAudioNow = useCallback(() => { stopNotificationAudio() }, [])
  const has = useCallback((code: string) => !!session?.permissionCodes.includes(code), [session])
  const canOpenPage = useCallback((id: Page, codes: string[]) => {
    if (id === 'dashboard') return codes.includes('dashboard.read')
    if (id === 'students') return ['students.read','students.create','students.edit','students.delete'].some(code => codes.includes(code))
    if (id === 'teachers') return ['teachers.read','teachers.create','teachers.edit','teachers.delete'].some(code => codes.includes(code))
    if (id === 'circles') return ['circles.read','circles.create','circles.edit','circles.delete'].some(code => codes.includes(code))
    if (id === 'schedule') return ['schedule.read','schedule.edit','attendance.read','attendance.edit'].some(code => codes.includes(code))
    if (id === 'payments') return ['finance.read','finance.create','finance.edit','finance.delete'].some(code => codes.includes(code))
    if (id === 'users') return codes.includes('users.manage')
    return ['settings.manage','audit.read','trash.manage','backup.manage','exports.manage'].some(code => codes.includes(code))
  }, [])
  const visiblePages = useMemo(() => navItems.filter(item => session && canOpenPage(item.id, session.permissionCodes)), [session, canOpenPage])
  const setFirstPage = useCallback((user: Session) => { setPage(navItems.find(item => canOpenPage(item.id, user.permissionCodes))?.id ?? 'dashboard') }, [canOpenPage])
  useEffect(() => {
    if (gate === 'ready' && session && visiblePages.length > 0 && !visiblePages.some(item => item.id === page)) setPage(visiblePages[0].id)
  }, [gate, session, page, visiblePages])

  const checkHealth = useCallback(async () => { try { const result = await request<{ status: string; database: string }>('/health'); setHealth(result.database === 'connected' ? 'connected' : 'down') } catch { setHealth('down') } }, [])
  const loadStudents = useCallback(async () => { if (!session?.permissionCodes.includes('students.read')) return; setStudents(await request<Student[]>('/api/students')) }, [session])
  const loadTeachers = useCallback(async () => { if (!session?.permissionCodes.includes('teachers.read')) return; setTeachers(await request<Teacher[]>('/api/teachers')) }, [session])
  const loadCircles = useCallback(async () => { if (!session?.permissionCodes.includes('circles.read')) return; setCircles(await request<Circle[]>('/api/circles')) }, [session])
  const loadScheduleSlots = useCallback(async () => { if (!session?.permissionCodes.some(code => ['schedule.read','schedule.edit','attendance.read','attendance.edit'].includes(code))) return; setScheduleSlots(await request<ScheduleSlot[]>('/api/schedule-slots')) }, [session])
  const loadAttendance = useCallback(async (month = currentMonthValue) => { if (!session?.permissionCodes.some(code => code === 'attendance.read' || code === 'attendance.edit')) return; const [teacherRows, studentSummaries] = await Promise.all([request<AttendanceRow[]>(`/api/teacher-attendance?month=${encodeURIComponent(month)}`), request<StudentAttendanceSummary[]>(`/api/student-attendance/session-summary?month=${encodeURIComponent(month)}`).catch(() => [] as StudentAttendanceSummary[])]); setAttendanceRows(teacherRows); setStudentAttendanceSummaries(studentSummaries) }, [session, currentMonthValue])
  const loadAdvertisingExpenses = useCallback(async (month = currentMonthValue) => { if (!session?.permissionCodes.includes('finance.read')) return; setAdvertisingExpenses(await request<AdExpense[]>(`/api/advertising-expenses?month=${encodeURIComponent(month)}`)) }, [session, currentMonthValue])
  const loadOperatingExpenses = useCallback(async (month = currentMonthValue) => { if (!session?.permissionCodes.includes('finance.read')) return; setOperatingExpenses(await request<OperatingExpense[]>(`/api/operating-expenses?month=${encodeURIComponent(month)}`)) }, [session, currentMonthValue])
  const loadCollections = useCallback(async (month = currentMonthValue) => { if (!session?.permissionCodes.includes('finance.read')) return; setCollections(await request<CollectionRow[]>(`/api/collections?month=${encodeURIComponent(month)}`)) }, [session, currentMonthValue])
  const loadReports = useCallback(async (month = currentMonthValue) => { if (!session?.permissionCodes.includes('finance.read')) return; setReports(await request<SavedReport[]>(`/api/collection-reports?month=${encodeURIComponent(month)}`)) }, [session, currentMonthValue])
  const loadUsers = useCallback(async () => { if (!session?.permissionCodes.includes('users.manage')) return; const [accountRows, permissionRows] = await Promise.all([request<AdminUser[]>('/api/admin/users'), request<Permission[]>('/api/admin/permissions')]); setUsers(accountRows); setPermissions(permissionRows) }, [session])
  const refreshAll = useCallback(async () => {
    if (busy) return
    const refreshStartedAt = Date.now()
    setBusy(true)
    const jobs: Promise<unknown>[] = [checkHealth()]
    if (session?.permissionCodes.includes('students.read')) jobs.push(loadStudents())
    if (session?.permissionCodes.includes('teachers.read')) jobs.push(loadTeachers())
    if (session?.permissionCodes.includes('circles.read')) jobs.push(loadCircles())
    if (session?.permissionCodes.some(code => ['schedule.read','schedule.edit','attendance.read','attendance.edit'].includes(code))) jobs.push(loadScheduleSlots()); if (session?.permissionCodes.some(code => code === 'attendance.read' || code === 'attendance.edit')) jobs.push(loadAttendance())
    if (session?.permissionCodes.includes('finance.read')) { jobs.push(loadCollections()); jobs.push(loadReports()); jobs.push(loadAdvertisingExpenses()); jobs.push(loadOperatingExpenses()) }
    if (session?.permissionCodes.includes('users.manage')) jobs.push(loadUsers())
    try { const results = await Promise.allSettled(jobs); const failures = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]; if (failures.length) setToast({ tone: 'error', text: failures[0].reason instanceof Error ? failures[0].reason.message : 'تعذر تحديث بعض البيانات.' }) }
    finally { const visibleDuration = Date.now() - refreshStartedAt; if (visibleDuration < 1150) await new Promise(resolve => window.setTimeout(resolve, 1150 - visibleDuration)); setBusy(false) }
  }, [busy, checkHealth, loadStudents, loadTeachers, loadCircles, loadScheduleSlots, loadAttendance, loadAdvertisingExpenses, loadOperatingExpenses, loadCollections, loadReports, loadUsers, session])

  useEffect(() => {
    let mounted = true
    const start = async () => {
      try {
        try { const publicBrand = await request<Branding>('/api/branding'); if (mounted) { setBranding(publicBrand); localStorage.setItem('dar-brand-name', publicBrand.brandName) } } catch { /* keep local fallback if branding cannot be loaded */ }
        const setupStatus = await request<{ needsInitialAdmin: boolean }>('/api/setup/status')
        if (!mounted) return
        if (setupStatus.needsInitialAdmin) { setGate('setup'); return }
        try { const me = await request<Session>('/api/auth/me'); if (!mounted) return; setSession(me); setFirstPage(me); setGate('ready') }
        catch { if (mounted) setGate('login') }
      } catch { if (mounted) { setGate('login'); setToast({ tone: 'error', text: 'تعذر الاتصال بالخادم. تأكد من تشغيل قاعدة البيانات والـ Backend.' }) } }
    }
    void start()
    return () => { mounted = false }
  }, [setFirstPage])
  useEffect(() => { if (gate === 'ready' && session) void refreshAll() }, [gate, session?.id])
  useEffect(() => { if (gate !== 'ready' || !session) return; if (has('finance.read')) { void loadCollections(currentMonthValue); void loadAdvertisingExpenses(currentMonthValue); void loadOperatingExpenses(currentMonthValue); if (page === 'payments') void loadReports(currentMonthValue) } }, [gate, session?.id, page, currentMonthValue, has, loadCollections, loadReports, loadAdvertisingExpenses, loadOperatingExpenses])
  useEffect(() => { if (gate !== 'ready' || !session) return; if (page === 'schedule' && (has('schedule.read')||has('schedule.edit')||has('attendance.read')||has('attendance.edit'))) void loadScheduleSlots(); if (has('attendance.read')||has('attendance.edit')) void loadAttendance(currentMonthValue) }, [gate, session?.id, page, currentMonthValue, has, loadScheduleSlots, loadAttendance])
  // Update the visible countdown every 30 seconds; second-by-second React renders add work without helping this admin dashboard.
  useEffect(() => { const timer = window.setInterval(() => setClockNow(Date.now()), 30_000); return () => window.clearInterval(timer) }, [])
  useEffect(() => { if (paymentReceiptPreview) return () => URL.revokeObjectURL(paymentReceiptPreview) }, [paymentReceiptPreview])
  useEffect(() => {
    if (gate !== 'ready' || !scheduleSlots.length || !scheduleNotificationsEnabled) return
    const date = localDateString(); const day = new Date(clockNow).getDay()
    const fireAlert = (title: string, body: string, key: string) => {
      if (firedClassAlertsRef.current.has(key)) return
      try { if (localStorage.getItem(key)) return } catch { /* Fall back to the in-memory key set. */ }
      firedClassAlertsRef.current.add(key)
      try { localStorage.setItem(key, '1') } catch { /* The in-memory key set prevents repeat alerts this session. */ }
      let deliveredAsSystemNotification = false
      if (notificationPermission === 'granted' && typeof Notification !== 'undefined') {
        try { new Notification(title, { body, tag: key }); deliveredAsSystemNotification = true } catch { /* Fall back to the in-app notice. */ }
      }
      if (!deliveredAsSystemNotification) setToast({ tone: 'info', text: `${title} · ${body}` })
      playNotificationSound(notificationSound, notificationDuration)
    }
    for (const slot of scheduleSlots) {
      if (!isScheduleAlertEnabled(slot.id) || slot.dayOfWeek !== day) continue
      const target = sessionDateTime(date, slot.startsAt).getTime()
      const minutesRemaining = target - clockNow
      const reminderKey = `dar-class-reminder10:${slot.id}:${date}`
      if (minutesRemaining > 0 && minutesRemaining <= 10 * 60 * 1000) {
        fireAlert(`موعد قريب: ${slot.circleName}`, `متبقي ${remainingLabel(minutesRemaining)} · المعلمة: ${slot.teacherName || 'لم تحدد'} · مدة الحلقة ${slot.durationMinutes} دقيقة`, reminderKey)
      }
      const startedKey = `dar-class-started:${slot.id}:${date}`
      if (minutesRemaining <= 0 && minutesRemaining >= -60_000) {
        fireAlert(`حان موعد الحلقة: ${slot.circleName}`, `${slot.teacherName || 'لم تحدد معلمة'} · مدة الحلقة ${slot.durationMinutes} دقيقة`, startedKey)
      }
    }
  }, [clockNow, gate, scheduleNotificationsEnabled, notificationPermission, scheduleSlots, isScheduleAlertEnabled, notificationSound, notificationDuration])

  const doSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (setup.password.length < 12) { setToast({ tone: 'error', text: 'كلمة مرور المدير يجب ألا تقل عن 12 حرفًا.' }); return }
    if (setup.password !== setup.confirmPassword) { setToast({ tone: 'error', text: 'تأكيد كلمة المرور غير مطابق.' }); return }
    setSaving(true)
    try { const created = await request<Session>('/api/setup/admin', { method: 'POST', body: JSON.stringify({ username: setup.username, displayName: setup.displayName, password: setup.password }) }); setSession(created); setFirstPage(created); setGate('ready'); setToast({ tone: 'success', text: 'تم إنشاء حساب المدير وتأمين لوحة الإدارة. احتفظ بكلمة المرور في مكان آمن.' }) }
    catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر إعداد الحساب الأول.' }) }
    finally { setSaving(false) }
  }
  const loginWithCredentials = async (credentials: { username: string; password: string; rememberMe: boolean }) => {
    setSaving(true)
    try {
      const signedIn = await request<Session>('/api/auth/login', { method: 'POST', body: JSON.stringify(credentials) })
      if (credentials.rememberMe) {
        try {
          const raw = localStorage.getItem('dar-saved-profiles')
          const old = raw ? JSON.parse(raw) : []
          const profiles = Array.isArray(old) ? old.filter((item: any) => item && typeof item.username === 'string') : []
          const next = [{ username: signedIn.username, displayName: signedIn.displayName, lastUsedAt: new Date().toISOString() }, ...profiles.filter((item: any) => item.username.toLowerCase() !== signedIn.username.toLowerCase())].slice(0, 6)
          localStorage.setItem('dar-saved-profiles', JSON.stringify(next))
        } catch { /* Saved profile shortcuts are optional; never interrupt a successful login. */ }
        // On the WPF desktop, the password vault encrypts this credential with the current Windows user's DPAPI key.
        saveDesktopCredential(signedIn.username, credentials.password, signedIn.displayName)
      }
      setLogin(current => ({ ...current, password: '', rememberMe: credentials.rememberMe }))
      setSession(signedIn); setFirstPage(signedIn); setGate('ready'); setToast({ tone: 'success', text: `أهلًا ${signedIn.displayName}. تم تسجيل الدخول.` })
      return true
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تسجيل الدخول. راجع البيانات.' })
      return false
    } finally { setSaving(false) }
  }
  const doLogin = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); await loginWithCredentials(login) }
  const quickLogin = async (credentials: { username: string; password: string; rememberMe: boolean }) => loginWithCredentials({ ...credentials, rememberMe: true })
  const logout = async () => { try { await request('/api/auth/logout', { method: 'POST' }) } catch { /* local state is still cleared */ } setSession(null); setGate('login'); setPage('dashboard'); setHistory(null); setSelectedStudent(null); setSelectedStudentPreview(null) }
  const moveRecordToTrash = async (entityType: string, entityId: string, displayName: string) => {
    if (!has('trash.manage')) { setToast({tone:'error',text:'لا يمكن حذف السجل من هذا الحساب. اطلب صلاحية إدارة سلة المهملات من المدير.'}); return false }
    if (!window.confirm(`نقل «${displayName}» إلى سلة المهملات؟ يمكنك استعادته قبل انتهاء مدة الاحتفاظ.`)) return false
    try { await request('/api/admin/trash', { method: 'POST', body: JSON.stringify({ entityType, entityId }) }); setToast({tone:'success',text:`تم نقل «${displayName}» إلى سلة المهملات.`}); return true }
    catch (error) { setToast({tone:'error',text:error instanceof Error ? error.message : 'تعذر نقل السجل إلى سلة المهملات.'}); return false }
  }

  const closeDetailLayers = () => { historyRequestRef.current += 1; teacherHistoryRequestRef.current += 1; setHistory(null); setSelectedStudent(null); setSelectedStudentPreview(null); setHistoryLoading(false); setSelectedTeacherDetails(null); setTeacherHistory(null); setTeacherHistoryLoading(false); setTeacherHistoryError(''); setSelectedCircle(null); setReportView(null) }
  const openStudentCreate = () => { closeDetailLayers(); setEditingStudent(null); setStudentForm(blankStudent()); setStudentModal(true) }
  const duplicateStudent = (student: Student) => {
    if (!has('students.create')) { setToast({ tone: 'error', text: 'حسابك لا يملك صلاحية إضافة طالب جديد.' }); return }
    closeDetailLayers()
    setEditingStudent(null)
    setStudentForm({
      studentCode: '',
      fullName: student.fullName,
      ageYears: student.ageYears == null ? '' : String(student.ageYears),
      phone: student.phone ?? '',
      guardianName: student.guardianName ?? '',
      guardianPhone: student.guardianPhone ?? '',
      joinedOn: localDateString(),
      status: 'active',
      notes: '',
    })
    setStudentModal(true)
    setToast({ tone: 'info', text: 'تم نسخ البيانات الأساسية فقط. راجع الاسم والكود قبل الحفظ؛ لن تُنسخ الالتحاقات أو الحضور أو المدفوعات أو الملاحظات السابقة.' })
  }
  const openStudentEdit = (student: Student) => { closeDetailLayers(); setEditingStudent(student); setStudentForm({ studentCode: student.studentCode, fullName: student.fullName, ageYears: student.ageYears == null ? '' : String(student.ageYears), phone: student.phone ?? '', guardianName: student.guardianName ?? '', guardianPhone: student.guardianPhone ?? '', joinedOn: student.joinedOn.slice(0, 10), status: student.status, notes: student.notes ?? '' }); setStudentModal(true) }
  const saveStudent = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); try { await request(editingStudent ? `/api/students/${editingStudent.id}` : '/api/students', { method: editingStudent ? 'PUT' : 'POST', body: JSON.stringify({ ...studentForm, ageYears: studentForm.ageYears.trim() ? Number(studentForm.ageYears) : null, studentCode: studentForm.studentCode.trim() || null, phone: studentForm.phone.trim() || null, guardianName: studentForm.guardianName.trim() || null, guardianPhone: studentForm.guardianPhone.trim() || null, notes: studentForm.notes.trim() || null }) }); setStudentModal(false); await loadStudents(); if (selectedStudent?.id) await openHistory(selectedStudent.id); setToast({ tone: 'success', text: editingStudent ? 'تم حفظ تعديلات الطالب.' : 'تمت إضافة الطالب وحفظ بياناته.' }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ الطالب.' }) } finally { setSaving(false) } }
  const changeStudentStatus = async (student: Student, status: StudentStatus) => {
    if (status === student.status) return
    if (status === 'withdrawn' && !window.confirm(`الانسحاب النهائي للطالب ${student.fullName} سينهي جميع التحاقات الطالب النشطة والمتوقفة في كل الحلقات بتاريخ اليوم، مع الاحتفاظ بالحضور والتحصيلات والسجل التاريخي. لا يمكن التراجع عن ذلك بتغيير الحالة فقط. هل تريد المتابعة؟`)) return
    if (status === 'paused' && !window.confirm(`سيتم تغيير الحالة الإدارية لملف ${student.fullName} فقط. لن تتوقف التحاقاته تلقائيًا؛ أوقف كل التحاق من تفاصيل الحلقة إذا كان المطلوب إيقاف الدراسة في حلقة بعينها. هل تريد المتابعة؟`)) return
    try {
      await request(`/api/students/${student.id}/status`, { method: 'PATCH', body: JSON.stringify({ status, ...(status === 'withdrawn' ? { effectiveOn: localDateString() } : {}) }) })
      await Promise.all([loadStudents(), loadCircles(), loadCollections()])
      setToast({ tone: 'success', text: status === 'withdrawn' ? `تم تسجيل الانسحاب النهائي لـ${student.fullName} وإنهاء جميع التحاقاته مع الاحتفاظ بالتاريخ.` : `تم تغيير حالة ${student.fullName} إلى ${statusLabels[status]}.` })
    } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تغيير الحالة.' }) }
  }
  const deleteStudent = async (student: Student) => { const moved = await moveRecordToTrash('student', student.id, student.fullName); if (!moved) return; await loadStudents(); if (selectedStudent?.id === student.id) { setSelectedStudent(null); setSelectedStudentPreview(null); setHistory(null); setHistoryLoading(false) } }
  const openHistory = async (id: string, fallback?: { id: string; fullName: string; studentCode: string }) => {
    const requestId = ++historyRequestRef.current
    teacherHistoryRequestRef.current += 1
    const knownStudent = students.find(student => student.id === id) ?? null
    const preview = knownStudent ? { id: knownStudent.id, fullName: knownStudent.fullName, studentCode: knownStudent.studentCode } : (fallback?.id === id ? fallback : null)
    setSelectedCircle(null); setReportView(null); setSelectedTeacherDetails(null); setTeacherHistory(null); setTeacherHistoryLoading(false); setTeacherHistoryError('')
    setStudentModal(false); setTeacherModal(false); setCircleModal(false); setEnrollmentModal(false); setPaymentModal(false); setChargeModal(false); setUserModal(false)
    setHistory(null); setHistoryNote(''); setSelectedStudent(knownStudent); setSelectedStudentPreview(preview); setHistoryLoading(true)
    try {
      const result = await request<HistoryData>(`/api/students/${id}/history`)
      if (historyRequestRef.current !== requestId) return
      setHistory(result); setSelectedStudent(result.student); setSelectedStudentPreview({ id: result.student.id, fullName: result.student.fullName, studentCode: result.student.studentCode })
    } catch (error) {
      if (historyRequestRef.current === requestId) setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر فتح السجل التاريخي.' })
    } finally { if (historyRequestRef.current === requestId) setHistoryLoading(false) }
  }
  const closeHistory = () => { historyRequestRef.current += 1; setHistory(null); setSelectedStudent(null); setSelectedStudentPreview(null); setHistoryLoading(false); setHistoryNote('') }
  const openTeacherDetails = async (teacher: Teacher) => {
    closeDetailLayers(); setStudentModal(false); setTeacherModal(false); setCircleModal(false); setEnrollmentModal(false); setPaymentModal(false); setChargeModal(false); setUserModal(false)
    const requestId = ++teacherHistoryRequestRef.current
    setSelectedTeacherDetails(teacher); setTeacherHistory(null); setTeacherHistoryLoading(true); setTeacherHistoryError('')
    try {
      const result = await request<TeacherHistoryData>(`/api/teachers/${teacher.id}/history`)
      if (teacherHistoryRequestRef.current === requestId) setTeacherHistory(result)
    } catch (error) {
      if (teacherHistoryRequestRef.current === requestId) setTeacherHistoryError(error instanceof Error ? error.message : 'تعذر تحميل ملف المعلمة.')
    } finally { if (teacherHistoryRequestRef.current === requestId) setTeacherHistoryLoading(false) }
  }
  const closeTeacherDetails = () => { teacherHistoryRequestRef.current += 1; setSelectedTeacherDetails(null); setTeacherHistory(null); setTeacherHistoryLoading(false); setTeacherHistoryError('') }
  const addStudentNote = async () => { if (!history || !historyNote.trim()) return; try { await request(`/api/students/${history.student.id}/notes`, { method: 'POST', body: JSON.stringify({ noteText: historyNote }) }); setHistoryNote(''); await openHistory(history.student.id); setToast({ tone: 'success', text: 'تم حفظ الملاحظة في سجل الطالب.' }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ الملاحظة.' }) } }
  const deleteStudentNote = async (studentId: string, noteId: string) => { const note = history?.notes.find(n => n.id === noteId); if (!await moveRecordToTrash('student-note', noteId, note?.noteText.slice(0,80) || 'ملاحظة الطالب')) return; await openHistory(studentId) }
  const addTeacherNote = async (teacherId: string, noteText: string) => { if (!noteText.trim()) return false; try { await request(`/api/teachers/${teacherId}/notes`, { method: 'POST', body: JSON.stringify({ noteText: noteText.trim() }) }); const teacher = teacherHistory?.teacher ?? selectedTeacherDetails; if (teacher?.id === teacherId) await openTeacherDetails(teacher); setToast({ tone: 'success', text: 'تم حفظ الملاحظة في سجل المعلمة.' }); return true } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ ملاحظة المعلمة.' }); return false } }
  const deleteTeacherNote = async (teacherId: string, noteId: string) => { const note = teacherHistory?.notes.find(n => n.id === noteId); if (!await moveRecordToTrash('teacher-note', noteId, note?.noteText.slice(0,80) || 'ملاحظة المعلمة')) return; const teacher = teacherHistory?.teacher ?? selectedTeacherDetails; if (teacher?.id === teacherId) await openTeacherDetails(teacher) }

  const openTeacherCreate = () => { closeDetailLayers(); setEditingTeacher(null); setTeacherForm(blankTeacher()); setTeacherModal(true) }
  const openTeacherEdit = (teacher: Teacher) => { closeDetailLayers(); setEditingTeacher(teacher); setTeacherForm({ teacherCode: teacher.teacherCode, fullName: teacher.fullName, phone: teacher.phone ?? '', hourlyRate: String(teacher.hourlyRate ?? ''), status: teacher.status, notes: teacher.notes ?? '' }); setTeacherModal(true) }
  const saveTeacher = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); try { await request(editingTeacher ? `/api/teachers/${editingTeacher.id}` : '/api/teachers', { method: editingTeacher ? 'PUT' : 'POST', body: JSON.stringify({ ...teacherForm, teacherCode: teacherForm.teacherCode.trim() || null, phone: teacherForm.phone.trim() || null, notes: teacherForm.notes.trim() || null, ...(has('finance.read') && has('finance.edit') ? { hourlyRate: Number(teacherForm.hourlyRate) } : {}) }) }); setTeacherModal(false); await Promise.all([loadTeachers(), loadCircles()]); setToast({ tone: 'success', text: editingTeacher ? 'تم تعديل بيانات المعلمة.' : 'تمت إضافة المعلمة.' }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ المعلمة.' }) } finally { setSaving(false) } }
  const deleteTeacher = async (teacher: Teacher) => { if (!await moveRecordToTrash('teacher', teacher.id, teacher.fullName)) return; await Promise.all([loadTeachers(), loadCircles()]) }

  const openCircleCreate = () => { closeDetailLayers(); setEditingCircle(null); setCircleForm(blankCircle()); setCircleModal(true) }
  const openCircleEdit = (circle: Circle) => { closeDetailLayers(); setEditingCircle(circle); setCircleForm({ circleCode: circle.circleCode, name: circle.name, teacherId: circle.teacherId ?? '', monthlyFee: String(circle.monthlyFee ?? ''), scheduleText: circle.scheduleText ?? '', isActive: circle.isActive, startsOn: circle.startsOn }); setCircleModal(true) }
  const saveCircle = async (event: FormEvent<HTMLFormElement>, scheduleDrafts: CircleScheduleDraft[] = []) => {
    event.preventDefault()
    const normalizedDrafts = scheduleDrafts.map(row => ({ dayOfWeek: Number(row.dayOfWeek), startsAt: row.startsAt.trim(), durationMinutes: Number(row.durationMinutes) }))
    if (normalizedDrafts.some(row => !Number.isInteger(row.dayOfWeek) || row.dayOfWeek < 0 || row.dayOfWeek > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.startsAt) || !Number.isInteger(row.durationMinutes) || row.durationMinutes < 15 || row.durationMinutes > 360)) {
      setToast({ tone: 'error', text: 'راجع مواعيد الحلقة الجديدة: اختَر يومًا ووقتًا صحيحًا ومدة من 15 إلى 360 دقيقة.' })
      return
    }
    if (normalizedDrafts.length > 0 && (!circleForm.teacherId || !circleForm.isActive)) {
      setToast({ tone: 'error', text: 'لإضافة مواعيد فعلية، حدّد معلمة وفعّل الحلقة أولًا.' })
      return
    }
    const seen = new Set<string>()
    for (const row of normalizedDrafts) {
      const key = `${row.dayOfWeek}|${row.startsAt}`
      if (seen.has(key)) { setToast({ tone: 'error', text: 'يوجد موعد مكرر في مسودة الحلقة. راجع اليوم والوقت قبل الحفظ.' }); return }
      seen.add(key)
      if (editingCircle && scheduleSlots.some(slot => slot.isActive && slot.circleId === editingCircle.id && slot.dayOfWeek === row.dayOfWeek && slot.startsAt.slice(0, 5) === row.startsAt)) {
        setToast({ tone: 'error', text: 'هذا اليوم والوقت مسجلان بالفعل لهذه الحلقة. راجع جدولها الحالي بدل إنشاء موعد مكرر.' })
        return
      }
    }
    if (normalizedDrafts.length > 0 && !has('schedule.edit')) {
      setToast({ tone: 'error', text: 'لا يمكن حفظ هذه المسودة بمواعيد فعلية من الحساب الحالي؛ صلاحية إدارة المواعيد غير متاحة.' })
      return
    }
    setSaving(true)
    try {
      const savedCircle = await request<{ id: string }>(editingCircle ? `/api/circles/${editingCircle.id}` : '/api/circles', {
        method: editingCircle ? 'PUT' : 'POST',
        body: JSON.stringify({ ...circleForm, circleCode: circleForm.circleCode.trim() || null, teacherId: circleForm.teacherId || null, ...(has('finance.read') && has('finance.edit') ? { monthlyFee: Number(circleForm.monthlyFee) } : {}), scheduleText: circleForm.scheduleText.trim() || null, startsOn: circleForm.startsOn })
      })
      const scheduleErrors: string[] = []
      for (const row of normalizedDrafts) {
        try {
          await request('/api/schedule-slots', { method: 'POST', body: JSON.stringify({ circleId: savedCircle.id, dayOfWeek: row.dayOfWeek, startsAt: row.startsAt, durationMinutes: row.durationMinutes }) })
        } catch (error) {
          scheduleErrors.push(error instanceof Error ? error.message : `${row.dayOfWeek} · ${row.startsAt}`)
        }
      }
      setCircleModal(false)
      await Promise.all([loadCircles(), loadTeachers(), loadScheduleSlots(), loadAttendance()])
      if (scheduleErrors.length > 0) {
        const firstScheduleError = scheduleErrors[0]
        const remainingErrors = scheduleErrors.length - 1
        setToast({ tone: 'error', text: `تم حفظ بيانات الحلقة، لكن تعذّر حفظ بعض المواعيد: ${firstScheduleError}${remainingErrors > 0 ? ` (ومواعيد أخرى فاشلة: ${remainingErrors}).` : ''}` })
      } else {
        const scheduleText = normalizedDrafts.length ? ` وتم حفظ ${normalizedDrafts.length} موعد أسبوعي فعلي.` : ''
        setToast({ tone: 'success', text: `${editingCircle ? 'تم تعديل الحلقة.' : 'تم إنشاء الحلقة.'}${scheduleText}` })
      }
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ الحلقة.' })
    } finally { setSaving(false) }
  }
  const deleteCircle = async (circle: Circle) => { if (!await moveRecordToTrash('circle', circle.id, circle.name)) return; await Promise.all([loadCircles(), loadScheduleSlots(), loadAdvertisingExpenses(), loadOperatingExpenses()]); if (selectedCircle?.id === circle.id) setSelectedCircle(null) }
  const openCircleDetails = async (circle: Circle) => { if (!has('circles.read')) { setToast({ tone: 'error', text: 'حسابك لا يملك صلاحية عرض الحلقات.' }); return }; historyRequestRef.current += 1; teacherHistoryRequestRef.current += 1; setHistory(null); setSelectedStudent(null); setSelectedStudentPreview(null); setHistoryLoading(false); setSelectedTeacherDetails(null); setTeacherHistory(null); setTeacherHistoryLoading(false); setTeacherHistoryError(''); setReportView(null); setStudentModal(false); setTeacherModal(false); setCircleModal(false); setEnrollmentModal(false); setPaymentModal(false); setChargeModal(false); setUserModal(false); setSelectedCircle(circle); setCircleDetailsLoading(true); setPage('circles'); try { setCircleRoster(await request<CircleStudent[]>(`/api/circles/${circle.id}/students`)) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل الطلاب في الحلقة.' }) } finally { setCircleDetailsLoading(false) } }

  const saveScheduleSlot = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); try { await request('/api/schedule-slots', { method: 'POST', body: JSON.stringify({ circleId: scheduleForm.circleId, dayOfWeek: Number(scheduleForm.dayOfWeek), startsAt: scheduleForm.startsAt, durationMinutes: Number(scheduleForm.durationMinutes) }) }); await Promise.all([loadScheduleSlots(), loadAttendance()]); setToast({ tone: 'success', text: 'تم حفظ الموعد الأسبوعي وتحديث الحصص المتوقعة وكشف الحضور.' }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ موعد الحلقة.' }) } finally { setSaving(false) } }
  const removeScheduleSlot = async (slot: ScheduleSlot) => { if (!await moveRecordToTrash('schedule-slot', slot.id, `${slot.circleName} · ${weekDays[slot.dayOfWeek]} ${timeLabel(slot.startsAt)}`)) return; await Promise.all([loadScheduleSlots(), loadAttendance()]) }
  const markAttendance = async (slot: ScheduleSlot, date: string, status: AttendanceRow['status'], substituteTeacherId?: string) => { const label = status === 'present' ? 'حضور' : status === 'absent' ? 'غياب' : 'إلغاء الحصة'; const selectedTeacher = substituteTeacherId ? teachers.find(item => item.id === substituteTeacherId) : undefined; const teacherName = selectedTeacher?.fullName ?? slot.teacherName; const substituteMessage = selectedTeacher && selectedTeacher.id !== slot.teacherId ? ` كبديلة عن ${slot.teacherName}` : ''; if (!window.confirm(`تسجيل ${label} للمعلمة ${teacherName}${substituteMessage} في حلقة ${slot.circleName} يوم ${formatDate(date)}؟`)) return false; try { const saved = await request<{payableAmount:number|null;hourlyRateSnapshot:number|null;teacherName?:string;isSubstitute?:boolean}>('/api/teacher-attendance', { method: 'POST', body: JSON.stringify({ scheduleSlotId: slot.id, sessionDate: date, status, note: null, teacherId: substituteTeacherId ?? null }) }); await loadAttendance(); setToast({ tone: 'success', text: status === 'present' ? (has('finance.read') ? `تم تسجيل حضور ${saved.teacherName ?? teacherName}. المستحق لهذه الحصة ${money(saved.payableAmount)} (أجر الساعة المحفوظ ${money(saved.hourlyRateSnapshot)}).` : `تم تسجيل حضور ${saved.teacherName ?? teacherName} بنجاح.`) : `تم تسجيل ${label} ولن تُحتسب أجرة لهذه الحصة.` }); return true } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تسجيل الحضور.' }); return false } }
  const updateAttendanceDuration = async (attendanceId: string, durationMinutes: number) => { if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 360) { setToast({ tone: 'error', text: 'مدة الحصة يجب أن تكون بين 15 و360 دقيقة.' }); return }; try { const saved = await request<{ durationMinutes: number; payableAmount: number | null; status: string }>(`/api/teacher-attendance/${attendanceId}/duration`, { method: 'PUT', body: JSON.stringify({ durationMinutes }) }); await loadAttendance(); setToast({ tone: 'success', text: has('finance.read') ? `تم تعديل مدة الحضور إلى ${saved.durationMinutes} دقيقة وإعادة حساب المستحق إلى ${money(saved.payableAmount)}.` : `تم تعديل مدة الحضور إلى ${saved.durationMinutes} دقيقة بنجاح.` }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تعديل مدة الحضور.' }) } }
  const saveAdExpense = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); try { await request('/api/advertising-expenses', { method: 'POST', body: JSON.stringify({ circleId: adExpenseForm.circleId, platform: adExpenseForm.platform.trim() || null, startDate: adExpenseForm.startDate, daysCount: Number(adExpenseForm.daysCount), dailyCost: Number(adExpenseForm.dailyCost), note: adExpenseForm.note.trim() || null }) }); setAdExpenseForm(blankAdExpense()); await loadAdvertisingExpenses(); setToast({ tone: 'success', text: 'تم حفظ مصروف الإعلان وربطه بالحلقة.' }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ مصروف الإعلان.' }) } finally { setSaving(false) } }
  const deleteAdExpense = async (ad: AdExpense) => { if (!await moveRecordToTrash('advertising-expense', ad.id, `إعلان ${ad.circleName}`)) return; await loadAdvertisingExpenses() }
  const enableNotifications = async () => { if (typeof Notification === 'undefined') { setToast({ tone: 'error', text: 'هذا المتصفح لا يدعم إشعارات النظام.' }); return }; try { const permission = await Notification.requestPermission(); setNotificationPermission(permission); setToast({ tone: permission === 'granted' ? 'success' : 'info', text: permission === 'granted' ? 'تم السماح بإشعارات النظام. يمكنك إيقاف تذكيرات المواعيد من هذا الزر.' : 'لم يتم السماح بإشعارات النظام؛ يمكنك إبقاء التنبيهات داخل التطبيق.' }) } catch { setToast({ tone: 'error', text: 'تعذر تفعيل الإشعارات من المتصفح.' }) } }
  const toggleScheduleNotifications = useCallback(async () => {
    if (scheduleNotificationsEnabled) {
      setScheduleNotificationsEnabled(false)
      stopNotificationAudio()
      setToast({ tone: 'info', text: 'تم إيقاف تنبيهات مواعيد الحلقات على هذا الجهاز.' })
      return
    }
    setScheduleNotificationsEnabled(true)
    if (notificationPermission !== 'granted') await enableNotifications()
    else setToast({ tone: 'success', text: 'تم تفعيل تنبيهات مواعيد الحلقات.' })
  }, [scheduleNotificationsEnabled, notificationPermission, enableNotifications])
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
    if (!window.confirm(`سيتم إيقاف التحاق ${studentName} في حلقة ${circleName} اعتبارًا من اليوم فقط. لن تتأثر التحاقاته في الحلقات الأخرى، وسيُمنع تسجيل حضور جديد لهذا الالتحاق خلال فترة الإيقاف. هل تريد المتابعة؟`)) return
    setSaving(true)
    try {
      await request(`/api/enrollments/${enrollmentId}/pause`, { method: 'PATCH', body: JSON.stringify({ effectiveOn: localDateString(), reason: null }) })
      await refreshEnrollmentViews(circleId, studentId)
      setToast({ tone: 'success', text: `تم إيقاف التحاق ${studentName} في ${circleName} مؤقتًا.` })
    } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر إيقاف الالتحاق.' }) }
    finally { setSaving(false) }
  }
  const resumeEnrollment = async (enrollmentId: string, studentId: string, studentName: string, circleName: string, circleId = selectedCircle?.id ?? '') => {
    if (!window.confirm(`سيُستأنف التحاق ${studentName} في حلقة ${circleName} اعتبارًا من اليوم. لن تتأثر حالة التحاقه في الحلقات الأخرى. هل تريد المتابعة؟`)) return
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

  const openChargeCreate = (row: CollectionRow) => { closeDetailLayers(); setEditingChargeId(null); setChargeForm(blankCharge(row.enrollmentId, currentMonthValue, suggestedFirstMonthCharge(row, currentMonthValue))); setChargeModal(true) }
  const saveCharge = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); try { if (editingChargeId) await request(`/api/charges/${editingChargeId}`, { method: 'PUT', body: JSON.stringify({ amountDue: Number(chargeForm.amountDue), note: chargeForm.note.trim() || null }) }); else await request('/api/charges', { method: 'POST', body: JSON.stringify({ ...chargeForm, amountDue: Number(chargeForm.amountDue) }) }); setChargeModal(false); setEditingChargeId(null); await loadCollections(); setToast({ tone: 'success', text: editingChargeId ? 'تم تعديل الاستحقاق.' : 'تم تسجيل استحقاق الشهر للحلقة والطالب.' }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ الاستحقاق.' }) } finally { setSaving(false) } }
  const deleteCharge = async (row: CollectionRow) => { if (!row.chargeId || !await moveRecordToTrash('monthly-charge', row.chargeId, `استحقاق ${row.studentName} · ${row.circleName} · ${currentMonthValue}`)) return; await Promise.all([loadCollections(), loadStudents()]) }
  const deleteReport = async (report: SavedReport) => { if (!await moveRecordToTrash('collection-report', report.id, report.title)) return; await loadReports() }

  const openPaymentCreate = (row: CollectionRow) => { if (!row.chargeId) return; closeDetailLayers(); setPaymentForm(blankPayment(row.chargeId, row.balance)); setPaymentModal(true) }
  const savePayment = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); try { const data = { ...paymentForm, amount: Number(paymentForm.amount), paidAt: new Date().toISOString(), method: paymentForm.method || null, reference: paymentForm.reference.trim() || null, note: paymentForm.note.trim() || null }; if (paymentReceipt) { const form = new FormData(); Object.entries(data).forEach(([key,value])=>form.append(key, value == null ? '' : String(value))); form.append('receipt',paymentReceipt); await requestForm('/api/payments/with-receipt',form) } else { await request('/api/payments', { method: 'POST', body: JSON.stringify(data) }) } setPaymentModal(false); setPaymentReceipt(null); setPaymentReceiptPreview(null); await Promise.all([loadCollections(), loadStudents()]); if (selectedStudent) await openHistory(selectedStudent.id); setToast({ tone: 'success', text: paymentReceipt ? 'تم تسجيل التحصيل وحفظ صورة الإيصال داخل قاعدة البيانات.' : 'تم تسجيل مبلغ التحصيل.' }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تسجيل التحصيل.' }) } finally { setSaving(false) } }
  const deletePayment = async (id: string, studentId?: string) => { if (!await moveRecordToTrash('payment', id, 'حركة تحصيل')) return; await Promise.all([loadCollections(), loadStudents()]); if (studentId) await openHistory(studentId) }

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

  const openUserCreate = () => { closeDetailLayers(); setEditingUser(null); setUserForm({ username: '', displayName: '', password: '', isActive: true, permissionCodes: ['dashboard.read'] }); setUserModal(true) }
  const openUserEdit = (user: AdminUser) => { closeDetailLayers(); setEditingUser(user); setUserForm({ id: user.id, username: user.username, displayName: user.displayName, password: '', isActive: user.isActive, permissionCodes: [...user.permissionCodes] }); setUserModal(true) }
  const saveUser = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); try { const payload = { ...userForm, password: userForm.password || null }; if (editingUser) await request(`/api/admin/users/${editingUser.id}`, { method: 'PUT', body: JSON.stringify(payload) }); else await request('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) }); setUserModal(false); await loadUsers(); setToast({ tone: 'success', text: editingUser ? 'تم تحديث الحساب وصلاحياته.' : 'تم إنشاء الحساب بالصلاحيات المحددة.' }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ الحساب.' }) } finally { setSaving(false) } }
  const deactivateUser = async (user: AdminUser) => { if (!window.confirm(`تعطيل حساب «${user.displayName}»؟ لن يستطيع تسجيل الدخول بعد ذلك.`)) return; try { await request(`/api/admin/users/${user.id}`, { method: 'DELETE' }); await loadUsers(); setToast({ tone: 'success', text: 'تم تعطيل الحساب.' }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تعطيل الحساب.' }) } }

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
  const downloadProfitSummary = () => {
    const rows: [string, string | number][] = [
      ['الدار', branding.brandName], ['الشهر', currentMonthValue],
      ['الاستحقاقات المسجلة', dashboardProfit.billed], ['المحصل فعليًا', dashboardProfit.collected], ['المتبقي للتحصيل', dashboardProfit.balance],
      ['أجور الحضور المستحقة', dashboardProfit.teacherPay], ['تكلفة الإعلانات', dashboardProfit.advertising],
      ['المصروفات التشغيلية الأخرى', dashboardProfit.otherExpenses], ['صافي التشغيل التقديري', dashboardProfit.net],
      ['التحاقات بلا استحقاق مسجل', dashboardProfit.withoutChargeCount], ['حصص فات موعدها بلا تسجيل حضور', dashboardProfit.unmarkedPastSessions],
      ['ملاحظة', 'صافي تقديري من السجلات المدخلة، وليس رصيدًا نقديًا. لا يشمل التكاليف غير المسجلة.'],
      ['— تفصيل أجور المعلمات —', ''],
    ]
    for (const teacher of teacherPaySummary) {
      rows.push([`المعلمة: ${teacher.teacherName} | عدد الحصص`, teacher.sessions])
      rows.push([`المعلمة: ${teacher.teacherName} | ساعات الحضور`, Number(teacher.hours.toFixed(2))])
      rows.push([`المعلمة: ${teacher.teacherName} | مستحق الأجر`, teacher.payable])
    }
    rows.push(['— مساهمة كل حلقة —', ''])
    for (const circle of circleProfitSummary) {
      rows.push([`الحلقة: ${circle.circleName} | الاستحقاق`, circle.billed])
      rows.push([`الحلقة: ${circle.circleName} | المحصل`, circle.collected])
      rows.push([`الحلقة: ${circle.circleName} | أجور المعلمات`, circle.teacherPay])
      rows.push([`الحلقة: ${circle.circleName} | الإعلانات`, circle.advertising])
      rows.push([`الحلقة: ${circle.circleName} | المصروفات المرتبطة`, circle.linkedExpenses])
      rows.push([`الحلقة: ${circle.circleName} | الصافي التقديري`, circle.net])
    }
    const quote = (value: string | number) => `"${String(value).replaceAll('"','""')}"`
    safeDownload(`نتيجة-تشغيل-الدار-${currentMonthValue}.csv`, '\ufeff' + rows.map(row => row.map(quote).join(',')).join('\r\n'), 'text/csv;charset=utf-8')
  }
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
    theme,
    setTheme,
    gate,
    setGate,
    branding,
    setBranding,
    avatarVersion,
    setAvatarVersion,
    avatarAvailable,
    setAvatarAvailable,
    avatarInputRef,
    session,
    setSession,
    setup,
    setSetup,
    login,
    setLogin,
    page,
    setPage,
    health,
    setHealth,
    students,
    setStudents,
    teachers,
    setTeachers,
    circles,
    setCircles,
    scheduleSlots,
    setScheduleSlots,
    attendanceRows,
    studentAttendanceSummaries,
    setAttendanceRows,
    advertisingExpenses,
    setAdvertisingExpenses,
    operatingExpenses,
    setOperatingExpenses,
    operatingExpenseForm,
    setOperatingExpenseForm,
    editingOperatingExpenseId,
    setEditingOperatingExpenseId,
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
    scheduleForm,
    setScheduleForm,
    adExpenseForm,
    setAdExpenseForm,
    paymentReceipt,
    setPaymentReceipt,
    paymentReceiptPreview,
    setPaymentReceiptPreview,
    collections,
    setCollections,
    reports,
    setReports,
    users,
    setUsers,
    permissions,
    setPermissions,
    circleRoster,
    setCircleRoster,
    currentMonthValue,
    setCurrentMonthValue,
    query,
    setQuery,
    statusFilter,
    setStatusFilter,
    teacherFilter,
    setTeacherFilter,
    studentModal,
    setStudentModal,
    editingStudent,
    setEditingStudent,
    studentForm,
    setStudentForm,
    teacherModal,
    setTeacherModal,
    editingTeacher,
    setEditingTeacher,
    teacherForm,
    setTeacherForm,
    circleModal,
    setCircleModal,
    editingCircle,
    setEditingCircle,
    circleForm,
    setCircleForm,
    enrollmentModal,
    setEnrollmentModal,
    enrollmentForm,
    setEnrollmentForm,
    endingEnrollment,
    setEndingEnrollment,
    endEnrollmentDate,
    setEndEnrollmentDate,
    confirmEndEnrollment,
    chargeModal,
    setChargeModal,
    editingChargeId,
    setEditingChargeId,
    chargeForm,
    setChargeForm,
    paymentModal,
    setPaymentModal,
    paymentForm,
    setPaymentForm,
    userModal,
    setUserModal,
    editingUser,
    setEditingUser,
    userForm,
    setUserForm,
    selectedStudent,
    selectedStudentPreview,
    setSelectedStudent,
    selectedTeacherDetails,
    teacherHistory,
    teacherHistoryLoading,
    teacherHistoryError,
    history,
    setHistory,
    historyLoading,
    setHistoryLoading,
    historyNote,
    setHistoryNote,
    selectedCircle,
    setSelectedCircle,
    circleDetailsLoading,
    setCircleDetailsLoading,
    reportView,
    setReportView,
    saving,
    setSaving,
    busy,
    setBusy,
    toast,
    setToast,
    has,
    canOpenPage,
    visiblePages,
    setFirstPage,
    checkHealth,
    loadStudents,
    loadTeachers,
    loadCircles,
    loadScheduleSlots,
    loadAttendance,
    loadAdvertisingExpenses,
    loadOperatingExpenses,
    loadCollections,
    loadReports,
    loadUsers,
    refreshAll,
    doSetup,
    doLogin,
    quickLogin,
    logout,
    moveRecordToTrash,
    closeDetailLayers,
    openStudentCreate,
    duplicateStudent,
    openStudentEdit,
    saveStudent,
    changeStudentStatus,
    deleteStudent,
    openHistory,
    closeHistory,
    openTeacherDetails,
    closeTeacherDetails,
    addStudentNote,
    deleteStudentNote,
    addTeacherNote,
    deleteTeacherNote,
    openTeacherCreate,
    openTeacherEdit,
    saveTeacher,
    deleteTeacher,
    openCircleCreate,
    openCircleEdit,
    saveCircle,
    deleteCircle,
    openCircleDetails,
    saveScheduleSlot,
    removeScheduleSlot,
    markAttendance,
    updateAttendanceDuration,
    saveAdExpense,
    deleteAdExpense,
    enableNotifications,
    nextSessions,
    monthSessions,
    monthlyTeacherPay,
    openEnrollmentCreate,
    saveEnrollment,
    endEnrollment,
    pauseEnrollment,
    resumeEnrollment,
    openChargeCreate,
    saveCharge,
    deleteCharge,
    deleteReport,
    openPaymentCreate,
    savePayment,
    deletePayment,
    createReport,
    openSavedReport,
    downloadCollectionSvg,
    downloadSavedCsv,
    downloadSavedJson,
    resetOperatingExpenseForm,
    editOperatingExpense,
    saveOperatingExpense,
    deleteOperatingExpense,
    openUserCreate,
    openUserEdit,
    saveUser,
    deactivateUser,
    filteredStudents,
    filteredTeachers,
    currentTitle,
    currentMonthTotals,
    monthlyTeacherPayTotal,
    monthlyAdvertisingTotal,
    monthlyOperatingExpenseTotal,
    dashboardProfit,
    teacherPaySummary,
    circleProfitSummary,
    downloadProfitSummary,
    changePage,
    notifySystem,
    saveBranding,
    uploadAvatar
  }
}

export type DarApplicationContext = ReturnType<typeof useDarApplication>