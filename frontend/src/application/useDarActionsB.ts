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


import type { DarApplicationState } from './useDarApplicationState'
import { useDarActionsA } from './useDarActionsA'

export function useDarActionsB(state: DarApplicationState, actionsA: ReturnType<typeof useDarActionsA>) {
  const {
    moveRecordToTrash, closeDetailLayers, openUserCreate, openUserEdit,
    saveUser, deactivateUser, openStudentCreate, duplicateStudent,
    openStudentEdit, saveStudent, changeStudentStatus, deleteStudent,
    openHistory, closeHistory, addStudentNote, deleteStudentNote,
    openTeacherDetails, closeTeacherDetails, addTeacherNote, deleteTeacherNote,
    openTeacherCreate, openTeacherEdit, saveTeacher, deleteTeacher,
    openCircleCreate, openCircleEdit, saveCircle, deleteCircle,
    openCircleDetails, saveScheduleSlot, removeScheduleSlot, markAttendance,
    updateAttendanceDuration, resetAdExpenseForm, openAdExpenseEdit, saveAdExpense,
    deleteAdExpense, nextSessions, monthSessions, monthlyTeacherPay,
    openEnrollmentCreate, saveEnrollment, endEnrollment, refreshEnrollmentViews,
    pauseEnrollment, resumeEnrollment, confirmEndEnrollment,
  } = actionsA
  const {
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
  } = state
  const openChargeCreate = (row: CollectionRow) => { closeDetailLayers(); setEditingChargeId(null); chargeIdempotencyKeyRef.current = newIdempotencyKey(); setChargeForm(blankCharge(row.enrollmentId, currentMonthValue, getSuggestedMonthlyCharge(row))); setChargeModal(true) }
  const saveCharge = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const editing = Boolean(editingChargeId)
    const parsedAmount = parseMoneyInput(chargeForm.amountDue, { allowZero: true })
    if (!parsedAmount.ok) { setToast({ tone: 'error', text: parsedAmount.error }); return }
    const key = chargeIdempotencyKeyRef.current ??= newIdempotencyKey()
    setSaving(true)
    try {
      if (editing) {
        await request(`/api/charges/${editingChargeId}`, { method: 'PUT', body: JSON.stringify({ amountDue: parsedAmount.value, note: chargeForm.note.trim() || null }) })
      } else {
        await request('/api/charges', { method: 'POST', headers: idempotencyHeaders(key), body: JSON.stringify({ ...chargeForm, amountDue: parsedAmount.value }) })
      }
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ الاستحقاق.' })
      setSaving(false)
      return
    }
    setSaving(false)
    setChargeModal(false)
    setEditingChargeId(null)
    setToast({ tone: 'success', text: editing ? 'تم تعديل الاستحقاق.' : 'تم تسجيل استحقاق الشهر للحلقة والطالب.' })
    try {
      await loadCollections()
    } catch {
      setToast({ tone: 'info', text: 'تم حفظ الاستحقاق، لكن تعذر تحديث القائمة. اضغط تحديث للمراجعة.' })
    }
  }
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

  const openPaymentCreate = (row: CollectionRow) => { if (!row.chargeId) return; closeDetailLayers(); paymentIdempotencyKeyRef.current = newIdempotencyKey(); setPaymentForm(blankPayment(row.chargeId, row.balance)); setPaymentModal(true) }
  const savePayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const key = paymentIdempotencyKeyRef.current ??= newIdempotencyKey()
    const parsedAmount = parseMoneyInput(paymentForm.amount)
    if (!parsedAmount.ok) { setToast({ tone: 'error', text: parsedAmount.error }); return }
    const data = { ...paymentForm, amount: parsedAmount.value, method: paymentForm.method || null, reference: paymentForm.reference.trim() || null, note: paymentForm.note.trim() || null }
    setSaving(true)
    try {
      if (paymentReceipt) {
        const form = new FormData()
        Object.entries(data).forEach(([field, value]) => form.append(field, value == null ? '' : String(value)))
        form.append('receipt', paymentReceipt)
        await requestForm('/api/payments/with-receipt', form, { headers: idempotencyHeaders(key) })
      } else {
        await request('/api/payments', { method: 'POST', headers: idempotencyHeaders(key), body: JSON.stringify(data) })
      }
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تسجيل التحصيل.' })
      setSaving(false)
      return
    }
    setSaving(false)
    setPaymentModal(false)
    setPaymentReceipt(null)
    setPaymentReceiptPreview(null)
    setToast({ tone: 'success', text: paymentReceipt ? 'تم تسجيل التحصيل وحفظ صورة الإيصال داخل قاعدة البيانات.' : 'تم تسجيل مبلغ التحصيل.' })
    try {
      await Promise.all([loadCollections(), loadStudents()])
      if (selectedStudent) await openHistory(selectedStudent.id)
    } catch {
      setToast({ tone: 'info', text: 'تم تسجيل التحصيل، لكن تعذر تحديث القوائم. اضغط تحديث للمراجعة.' })
    }
  }

  const createReport = async () => { setSaving(true); try { await request('/api/collection-reports', { method: 'POST', body: JSON.stringify({ billingMonth: currentMonthValue, title: `تقرير تحصيل ${currentMonthValue}` }) }); await loadReports(); setToast({ tone: 'success', text: 'تم حفظ نسخة ثابتة من تقرير التحصيل في النظام.' }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ التقرير.' }) } finally { setSaving(false) } }
  const openSavedReport = async (report: SavedReport) => { try { setReportView(await request<ReportSnapshot>(`/api/collection-reports/${report.id}`)) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر فتح التقرير المحفوظ.' }) } }
  const downloadCollectionSvg = () => safeDownload(`تحصيل-${currentMonthValue}.svg`, makeReportSvg('تقرير الاشتراكات والتحصيل', currentMonthValue, collections, { due: collections.reduce((s,r)=>s+r.amountDue,0), paid: collections.reduce((s,r)=>s+r.paidAmount,0), balance: collections.reduce((s,r)=>s+r.balance,0) }), 'image/svg+xml;charset=utf-8')
  const downloadSavedCsv = (report: ReportSnapshot) => safeDownload(`تحصيل-${report.billingMonth.slice(0,7)}.csv`, toCsv(report.snapshot.rows), 'text/csv;charset=utf-8')
  const downloadSavedJson = (report: ReportSnapshot) => safeDownload(`تحصيل-${report.billingMonth.slice(0,7)}.json`, JSON.stringify(report.snapshot,null,2), 'application/json;charset=utf-8')

  const resetOperatingExpenseForm = () => { setOperatingExpenseForm(blankOperatingExpense()); setEditingOperatingExpenseId(null) }
  const editOperatingExpense = (expense: OperatingExpense) => { setEditingOperatingExpenseId(expense.id); setOperatingExpenseForm({ expenseDate: expense.expenseDate.slice(0,10), category: expense.category, description: expense.description, amount: String(expense.amount), circleId: expense.circleId ?? '', note: expense.note ?? '' }) }
  const saveOperatingExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedAmount = parseMoneyInput(operatingExpenseForm.amount)
    if (!parsedAmount.ok) {
      setToast({ tone: 'error', text: parsedAmount.error })
      return
    }
    setSaving(true)
    const wasEditing = Boolean(editingOperatingExpenseId)
    try {
      const payload = { expenseDate: operatingExpenseForm.expenseDate, category: operatingExpenseForm.category.trim(), description: operatingExpenseForm.description.trim(), amount: parsedAmount.value, circleId: operatingExpenseForm.circleId || null, note: operatingExpenseForm.note.trim() || null }
      await request(editingOperatingExpenseId ? `/api/operating-expenses/${editingOperatingExpenseId}` : '/api/operating-expenses', { method: editingOperatingExpenseId ? 'PUT' : 'POST', body: JSON.stringify(payload) })
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ المصروف التشغيلي.' })
      setSaving(false)
      return
    }
    const expenseMonth = operatingExpenseForm.expenseDate.slice(0, 7)
    setSaving(false)
    resetOperatingExpenseForm()
    if (expenseMonth !== currentMonthValue) setCurrentMonthValue(expenseMonth)
    setToast({ tone: 'success', text: wasEditing ? 'تم تحديث المصروف التشغيلي.' : 'تم تسجيل المصروف التشغيلي.' })
    try {
      await loadOperatingExpenses(expenseMonth)
    } catch {
      setToast({ tone: 'info', text: 'تم حفظ المصروف، لكن تعذر تحديث القائمة. اضغط تحديث للمراجعة.' })
    }
  }
  const deleteOperatingExpense = async (expense: OperatingExpense) => { if (!await moveRecordToTrash('operating-expense', expense.id, expense.description)) return; await loadOperatingExpenses() }

  const filteredStudents = useMemo(() => getFilteredStudents(students, query, statusFilter), [students, query, statusFilter])
  const filteredTeachers = useMemo(() => getFilteredTeachers(teachers, query, teacherFilter), [teachers, query, teacherFilter])
  const currentTitle = navItems.find(item=>item.id===page)?.label ?? 'لوحة التحكم'
  const currentMonthTotals = useMemo(() => getCurrentMonthTotals(collections), [collections])
  const monthlyTeacherPayTotal = useMemo(() => getMonthlyTeacherPayTotal(attendanceRows), [attendanceRows])
  const monthlyAdvertisingTotal = useMemo(() => getMonthlyAdvertisingTotal(advertisingExpenses), [advertisingExpenses])
  const monthlyOperatingExpenseTotal = useMemo(() => getMonthlyOperatingExpenseTotal(operatingExpenses), [operatingExpenses])
  // FINAL Z2: the frontend no longer calculates money. It renders the server summary;
  // while the summary is loading/after an error the values are empty, never a local formula.
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
    openChargeCreate, saveCharge, openVoidCharge, openVoidPayment,
    closeVoidDialog, submitVoid, deleteReport, openPaymentCreate,
    savePayment, createReport, openSavedReport, downloadCollectionSvg,
    downloadSavedCsv, downloadSavedJson, resetOperatingExpenseForm, editOperatingExpense,
    saveOperatingExpense, deleteOperatingExpense, filteredStudents, filteredTeachers,
    currentTitle, currentMonthTotals, monthlyTeacherPayTotal, monthlyAdvertisingTotal,
    monthlyOperatingExpenseTotal, downloadProfitSummary, changePage, notifySystem,
    saveBranding, uploadAvatar,
  }
}
