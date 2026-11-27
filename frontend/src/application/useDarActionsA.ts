import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import type { Theme, Branding, Page, Gate, StudentStatus, TeacherStatus, Session, Student, Teacher, Circle, CollectionRow, Permission, AdminUser, SavedReport, HistoryData, CircleStudent, Notice, StudentForm, TeacherForm, CircleForm, CircleScheduleDraft, EnrollmentForm, ChargeForm, PaymentForm, UserForm, ReportSnapshot, ScheduleSlot, AttendanceRow, AdExpense, AdExpenseForm, OperatingExpense, OperatingExpenseForm, CircleProfitSummary, TeacherPaySummary, TeacherHistoryData, StudentAttendanceSummary, VoidTarget } from '../domain/types'
import { defaultBranding, weekDays, blankAdExpense, blankOperatingExpense, blankStudent, blankTeacher, blankCircle, blankEnrollment, blankCharge, blankPayment } from '../domain/defaults'
import { FINANCE_VOID_PERMISSION, VOID_REASON_MAX_LENGTH, VOID_REASON_MIN_LENGTH } from '../system/constants'
import { statusLabels } from '../domain/labels'
import { formatTime12 } from '../lib/dates'
import { cairoToday } from '../lib/cairoDate'
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

export function useDarActionsA(state: DarApplicationState) {
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

  const saveScheduleSlot = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    try {
      await request('/api/schedule-slots', { method: 'POST', body: JSON.stringify({ circleId: scheduleForm.circleId, dayOfWeek: Number(scheduleForm.dayOfWeek), startsAt: scheduleForm.startsAt, durationMinutes: Number(scheduleForm.durationMinutes) }) })
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ موعد الحلقة.' })
      setSaving(false)
      return
    }
    setSaving(false)
    setToast({ tone: 'success', text: 'تم حفظ الموعد الأسبوعي وتحديث الحصص المتوقعة وكشف الحضور.' })
    try {
      await Promise.all([loadScheduleSlots(), loadAttendance()])
    } catch {
      setToast({ tone: 'info', text: 'تم حفظ الموعد، لكن تعذر تحديث الجدول. اضغط تحديث للمراجعة.' })
    }
  }
  const removeScheduleSlot = async (slot: ScheduleSlot) => { if (!await moveRecordToTrash('schedule-slot', slot.id, `${slot.circleName} · ${weekDays[slot.dayOfWeek]} ${formatTime12(slot.startsAt)}`)) return; await Promise.all([loadScheduleSlots(), loadAttendance()]) }
  const markAttendance = async (slot: ScheduleSlot, date: string, status: AttendanceRow['status'], substituteTeacherId?: string) => { const label = status === 'present' ? 'حضور' : status === 'absent' ? 'غياب' : 'إلغاء الحصة'; const selectedTeacher = substituteTeacherId ? teachers.find(item => item.id === substituteTeacherId) : undefined; const teacherName = selectedTeacher?.fullName ?? slot.teacherName; const substituteMessage = selectedTeacher && selectedTeacher.id !== slot.teacherId ? ` كبديلة عن ${slot.teacherName}` : ''; if (!(await confirmAction({ title: 'تأكيد تسجيل الحضور', message: `تسجيل ${label} للمعلمة ${teacherName}${substituteMessage} في حلقة ${slot.circleName} يوم ${formatDate(date)}؟`, confirmLabel: 'متابعة' }))) return false; try { const saved = await request<{payableAmount:number|null;hourlyRateSnapshot:number|null;teacherName?:string;isSubstitute?:boolean}>('/api/teacher-attendance', { method: 'POST', body: JSON.stringify({ scheduleSlotId: slot.id, sessionDate: date, status, note: null, teacherId: substituteTeacherId ?? null }) }); await loadAttendance(); setToast({ tone: 'success', text: status === 'present' ? (has('finance.read') ? `تم تسجيل حضور ${saved.teacherName ?? teacherName}. المستحق لهذه الحصة ${money(saved.payableAmount)} (أجر الساعة المحفوظ ${money(saved.hourlyRateSnapshot)}).` : `تم تسجيل حضور ${saved.teacherName ?? teacherName} بنجاح.`) : `تم تسجيل ${label} ولن تُحتسب أجرة لهذه الحصة.` }); return true } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تسجيل الحضور.' }); return false } }
  const updateAttendanceDuration = async (attendanceId: string, durationMinutes: number) => { if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 360) { setToast({ tone: 'error', text: 'مدة الحصة يجب أن تكون بين 15 و360 دقيقة.' }); return }; try { const saved = await request<{ durationMinutes: number; payableAmount: number | null; status: string }>(`/api/teacher-attendance/${attendanceId}/duration`, { method: 'PUT', body: JSON.stringify({ durationMinutes }) }); await loadAttendance(); setToast({ tone: 'success', text: has('finance.read') ? `تم تعديل مدة الحضور إلى ${saved.durationMinutes} دقيقة وإعادة حساب المستحق إلى ${money(saved.payableAmount)}.` : `تم تعديل مدة الحضور إلى ${saved.durationMinutes} دقيقة بنجاح.` }) } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تعديل مدة الحضور.' }) } }
  const resetAdExpenseForm = () => { setEditingAdExpenseId(null); setAdExpenseForm(blankAdExpense()) }
  const openAdExpenseEdit = (ad: AdExpense) => { if (!has('finance.edit') || !has('finance.read')) { setToast({ tone: 'error', text: 'تعديل مصروف الإعلان يحتاج صلاحية تعديل المالية وقراءتها.' }); return } setEditingAdExpenseId(ad.id); setAdExpenseForm({ circleId: ad.circleId, platform: ad.platform ?? '', startDate: ad.startDate.slice(0, 10), daysCount: String(ad.daysCount), dailyCost: String(ad.dailyCost), note: ad.note ?? '' }) }
  const saveAdExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const wasEditing = Boolean(editingAdExpenseId)
    const parsedDailyCost = parseMoneyInput(adExpenseForm.dailyCost)
    if (!parsedDailyCost.ok) { setToast({ tone: 'error', text: parsedDailyCost.error }); return }
    const daysCount = Number(adExpenseForm.daysCount)
    if (!Number.isInteger(daysCount) || daysCount < 1 || daysCount > 3650) { setToast({ tone: 'error', text: 'عدد الأيام يجب أن يكون بين 1 و3650.' }); return }
    const payload = { circleId: adExpenseForm.circleId, platform: adExpenseForm.platform.trim() || null, startDate: adExpenseForm.startDate, daysCount, dailyCost: parsedDailyCost.value, note: adExpenseForm.note.trim() || null }
    setSaving(true)
    try {
      if (wasEditing) await request(`/api/advertising-expenses/${editingAdExpenseId}`, { method: 'PUT', body: JSON.stringify(payload) })
      else await request('/api/advertising-expenses', { method: 'POST', body: JSON.stringify(payload) })
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : (wasEditing ? 'تعذر تعديل مصروف الإعلان.' : 'تعذر حفظ مصروف الإعلان.') })
      setSaving(false)
      return
    }
    setSaving(false)
    resetAdExpenseForm()
    setToast({ tone: 'success', text: wasEditing ? 'تم تعديل مصروف الإعلان وتحديث الإجمالي والتقارير.' : 'تم حفظ مصروف الإعلان وربطه بالحلقة.' })
    try {
      await loadAdvertisingExpenses()
    } catch {
      setToast({ tone: 'info', text: 'تم حفظ مصروف الإعلان، لكن تعذر تحديث القائمة. اضغط تحديث للمراجعة.' })
    }
  }
  const deleteAdExpense = async (ad: AdExpense) => { if (!await moveRecordToTrash('advertising-expense', ad.id, `إعلان ${ad.circleName}`)) return; await loadAdvertisingExpenses() }
  const nextSessions = useMemo(() => getNextSessions(scheduleSlots, circles, clockNow), [scheduleSlots, circles, clockNow])
  const monthSessions = useMemo(() => getMonthSessions(scheduleSlots, attendanceRows, currentMonthValue), [scheduleSlots, attendanceRows, currentMonthValue])
  const monthlyTeacherPay = useMemo(() => getMonthlyTeacherPay(attendanceRows), [attendanceRows])

  const openEnrollmentCreate = (studentId = '', circleId = '', fee: number | null = 0) => { setHistory(null); setSelectedStudent(null); setSelectedCircle(null); setEnrollmentForm(blankEnrollment(studentId, circleId, fee)); setEnrollmentModal(true) }
  const saveEnrollment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    const canEditFinancials = has('finance.read') && has('finance.edit')
    const parsedFee = parseMoneyInput(enrollmentForm.agreedMonthlyFee, { allowZero: true })
    if (canEditFinancials && !parsedFee.ok) { setToast({ tone: 'error', text: parsedFee.error }); return }
    const payload = { studentId: enrollmentForm.studentId, circleId: enrollmentForm.circleId, startsOn: enrollmentForm.startsOn, ...(canEditFinancials && parsedFee.ok ? { agreedMonthlyFee: parsedFee.value } : {}), allowClosedCircle: Boolean(enrollmentForm.allowClosedCircle) }
    try {
      await request('/api/enrollments', { method: 'POST', body: JSON.stringify(payload) })
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تسجيل الالتحاق.' })
      setSaving(false)
      return
    }
    setSaving(false)
    setEnrollmentModal(false)
    setToast({ tone: 'success', text: 'تم إلحاق الطالب بالحلقة وحفظ تاريخ الالتحاق.' })
    try {
      await Promise.all([loadStudents(), loadCircles(), loadCollections()])
      if (selectedStudent) await openHistory(selectedStudent.id)
      if (selectedCircle) await openCircleDetails(selectedCircle)
    } catch {
      setToast({ tone: 'info', text: 'تم تسجيل الالتحاق، لكن تعذر تحديث القوائم. اضغط تحديث للمراجعة.' })
    }
  }
  const endEnrollment = async (enrollmentId: string, studentId: string, studentName = 'الطالب', circleName = 'الحلقة', circleId = selectedCircle?.id ?? '') => { setEndEnrollmentDate(cairoToday()); setEndingEnrollment({ enrollmentId, studentId, studentName, circleId, circleName }) }
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
      await request(`/api/enrollments/${enrollmentId}/pause`, { method: 'PATCH', body: JSON.stringify({ effectiveOn: cairoToday(), reason: null }) })
      await refreshEnrollmentViews(circleId, studentId)
      setToast({ tone: 'success', text: `تم إيقاف التحاق ${studentName} في ${circleName} مؤقتًا.` })
    } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر إيقاف الالتحاق.' }) }
    finally { setSaving(false) }
  }
  const resumeEnrollment = async (enrollmentId: string, studentId: string, studentName: string, circleName: string, circleId = selectedCircle?.id ?? '') => {
    if (!(await confirmAction({ title: 'تأكيد العملية', message: `سيُستأنف التحاق ${studentName} في حلقة ${circleName} اعتبارًا من اليوم. لن تتأثر حالة التحاقه في الحلقات الأخرى. هل تريد المتابعة؟`, confirmLabel: 'متابعة' }))) return
    setSaving(true)
    try {
      await request(`/api/enrollments/${enrollmentId}/resume`, { method: 'PATCH', body: JSON.stringify({ effectiveOn: cairoToday(), reason: null }) })
      await refreshEnrollmentViews(circleId, studentId)
      setToast({ tone: 'success', text: `تم استئناف التحاق ${studentName} في ${circleName}.` })
    } catch (error) { setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر استئناف الالتحاق.' }) }
    finally { setSaving(false) }
  }
  const confirmEndEnrollment = async () => {
    if (!endingEnrollment) return
    if (!endEnrollmentDate || endEnrollmentDate > cairoToday()) { setToast({ tone: 'error', text: 'اختَر تاريخ نهاية مسجلًا اليوم أو قبله.' }); return }
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

  return {
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
  }
}
