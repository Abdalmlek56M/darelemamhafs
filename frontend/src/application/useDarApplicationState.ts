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
import { idempotencyHeaders, newIdempotencyKey } from '../lib/idempotency'
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
} from './selectors'
import { confirmAction } from '../components/common/confirmService'
import useProfitSummary, { type ProfitDashboardSummary } from './useProfitSummary'
import { parseMoneyInput } from '../lib/money'


export function useDarApplicationState() {

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
  const [editingAdExpenseId, setEditingAdExpenseId] = useState<string | null>(null)
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
  const paymentIdempotencyKeyRef = useRef<string | null>(null)
  const chargeIdempotencyKeyRef = useRef<string | null>(null)
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
  const serverProfit = useProfitSummary(currentMonthValue, gate === 'ready' && Boolean(session) && has('finance.read'))
  const canOpenPage = useCallback((id: Page, codes: string[]) => {
    if (id === 'dashboard') return codes.includes('dashboard.read')
    if (id === 'students') return ['students.read','students.create','students.edit','students.delete'].some(code => codes.includes(code))
    if (id === 'teachers') return ['teachers.read','teachers.create','teachers.edit','teachers.delete'].some(code => codes.includes(code))
    if (id === 'circles') return ['circles.read','circles.create','circles.edit','circles.delete'].some(code => codes.includes(code))
    if (id === 'schedule') return ['schedule.read','schedule.edit','attendance.read','attendance.edit'].some(code => codes.includes(code))
    if (id === 'payments') return ['finance.read','finance.create','finance.edit','finance.delete','finance.void'].some(code => codes.includes(code))
    if (id === 'meet') return codes.includes('meet.view')
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

  const emptyDashboardProfit: ProfitDashboardSummary = {
    billed: 0, collected: 0, balance: 0, advertising: 0, teacherPay: 0,
    otherExpenses: 0, net: 0, withoutChargeCount: 0, unmarkedPastSessions: 0,
  }
  const dashboardProfit = serverProfit?.dashboard ?? emptyDashboardProfit
  const teacherPaySummary = serverProfit?.teachers ?? []
  const circleProfitSummary = serverProfit?.circles ?? []
  return {
    theme, setTheme, gate, setGate,
    branding, setBranding, avatarVersion, setAvatarVersion,
    avatarAvailable, setAvatarAvailable, avatarInputRef, session,
    setSession, page, setPage, health,
    setHealth, students, setStudents, teachers,
    setTeachers, circles, setCircles, scheduleSlots,
    setScheduleSlots, attendanceRows, setAttendanceRows, studentAttendanceSummaries,
    setStudentAttendanceSummaries, advertisingExpenses, setAdvertisingExpenses, operatingExpenses,
    setOperatingExpenses, operatingExpenseForm, setOperatingExpenseForm, editingOperatingExpenseId,
    setEditingOperatingExpenseId, scheduleForm, setScheduleForm, adExpenseForm,
    setAdExpenseForm, editingAdExpenseId, setEditingAdExpenseId, paymentReceipt,
    setPaymentReceipt, paymentReceiptPreview, setPaymentReceiptPreview, collections,
    setCollections, reports, setReports, users,
    setUsers, permissions, setPermissions, circleRoster,
    setCircleRoster, currentMonthValue, setCurrentMonthValue, query,
    setQuery, statusFilter, setStatusFilter, teacherFilter,
    setTeacherFilter, studentModal, setStudentModal, editingStudent,
    setEditingStudent, studentForm, setStudentForm, teacherModal,
    setTeacherModal, editingTeacher, setEditingTeacher, teacherForm,
    setTeacherForm, circleModal, setCircleModal, editingCircle,
    setEditingCircle, circleForm, setCircleForm, enrollmentModal,
    setEnrollmentModal, enrollmentForm, setEnrollmentForm, endingEnrollment,
    setEndingEnrollment, endEnrollmentDate, setEndEnrollmentDate, chargeModal,
    setChargeModal, editingChargeId, setEditingChargeId, chargeForm,
    setChargeForm, paymentModal, setPaymentModal, paymentForm,
    setPaymentForm, userModal, setUserModal, editingUser,
    setEditingUser, userForm, setUserForm, selectedStudent,
    setSelectedStudent, selectedStudentPreview, setSelectedStudentPreview, selectedTeacherDetails,
    setSelectedTeacherDetails, teacherHistory, setTeacherHistory, teacherHistoryLoading,
    setTeacherHistoryLoading, teacherHistoryError, setTeacherHistoryError, history,
    setHistory, historyLoading, setHistoryLoading, historyNote,
    setHistoryNote, historyRequestRef, paymentIdempotencyKeyRef, chargeIdempotencyKeyRef,
    teacherHistoryRequestRef, circleRosterRequestRef, selectedCircle, setSelectedCircle,
    circleDetailsLoading, setCircleDetailsLoading, reportView, setReportView,
    saving, setSaving, busy, setBusy,
    toast, setToast, voidTarget, setVoidTarget,
    voidReason, setVoidReason, clockNow, setClockNow,
    notificationPermission, setNotificationPermission, scheduleNotificationsEnabled, toggleScheduleNotifications,
    notificationSound, setNotificationSound, notificationDuration, setNotificationDuration,
    previewNotificationSound, stopNotificationAudioNow, isScheduleAlertEnabled, setScheduleAlertEnabled,
    enableNotifications, has, serverProfit, canOpenPage,
    visiblePages, setFirstPage, checkHealth, loadStudents,
    loadTeachers, loadCircles, loadScheduleSlots, loadAttendance,
    loadAdvertisingExpenses, loadOperatingExpenses, loadCollections, loadReports,
    loadUsers, refreshAll, clearSessionData, setup,
    setSetup, login, setLogin, doSetup,
    doLogin, quickLogin, logout, dashboardProfit,
    teacherPaySummary, circleProfitSummary,
    stopNotificationAudio: stopNotificationAudioNow,
  }
}

export type DarApplicationState = ReturnType<typeof useDarApplicationState>
