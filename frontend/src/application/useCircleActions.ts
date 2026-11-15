import type { FormEvent, MutableRefObject } from 'react'
import type {
  Circle,
  CircleForm,
  CircleScheduleDraft,
  CircleStudent,
  HistoryData,
  Notice,
  ReportSnapshot,
  ScheduleSlot,
  Student,
  Teacher,
  TeacherHistoryData,
} from '../domain/types'
import { blankCircle } from '../domain/defaults'
import { request } from '../services/apiClient'

type CircleActionsOptions = {
  has: (code: string) => boolean
  setToast: (notice: Notice) => void
  setSaving: (value: boolean) => void
  closeDetailLayers: () => void
  moveRecordToTrash: (entityType: string, entityId: string, displayName: string) => Promise<boolean>
  editingCircle: Circle | null
  circleForm: CircleForm
  scheduleSlots: ScheduleSlot[]
  selectedCircle: Circle | null
  setEditingCircle: (value: Circle | null) => void
  setCircleForm: (value: CircleForm) => void
  setCircleModal: (value: boolean) => void
  setStudentModal: (value: boolean) => void
  setTeacherModal: (value: boolean) => void
  setEnrollmentModal: (value: boolean) => void
  setPaymentModal: (value: boolean) => void
  setChargeModal: (value: boolean) => void
  setUserModal: (value: boolean) => void
  setSelectedCircle: (value: Circle | null) => void
  setCircleDetailsLoading: (value: boolean) => void
  setCircleRoster: (value: CircleStudent[]) => void
  setPage: (value: 'dashboard' | 'students' | 'teachers' | 'circles' | 'schedule' | 'payments' | 'users' | 'system') => void
  setHistory: (value: HistoryData | null) => void
  setHistoryLoading: (value: boolean) => void
  setSelectedStudent: (value: Student | null) => void
  setSelectedStudentPreview: (value: { id: string; fullName: string; studentCode: string } | null) => void
  setSelectedTeacherDetails: (value: Teacher | null) => void
  setTeacherHistory: (value: TeacherHistoryData | null) => void
  setTeacherHistoryLoading: (value: boolean) => void
  setTeacherHistoryError: (value: string) => void
  setReportView: (value: ReportSnapshot | null) => void
  historyRequestRef: MutableRefObject<number>
  teacherHistoryRequestRef: MutableRefObject<number>
  loadCircles: () => Promise<void>
  loadTeachers: () => Promise<void>
  loadScheduleSlots: () => Promise<void>
  loadAttendance: (month?: string) => Promise<void>
  loadAdvertisingExpenses: (month?: string) => Promise<void>
  loadOperatingExpenses: (month?: string) => Promise<void>
}

/** Circle CRUD, schedule-draft validation, and the circle roster drawer. */
export default function useCircleActions({
  has,
  setToast,
  setSaving,
  closeDetailLayers,
  moveRecordToTrash,
  editingCircle,
  circleForm,
  scheduleSlots,
  selectedCircle,
  setEditingCircle,
  setCircleForm,
  setCircleModal,
  setStudentModal,
  setTeacherModal,
  setEnrollmentModal,
  setPaymentModal,
  setChargeModal,
  setUserModal,
  setSelectedCircle,
  setCircleDetailsLoading,
  setCircleRoster,
  setPage,
  setHistory,
  setHistoryLoading,
  setSelectedStudent,
  setSelectedStudentPreview,
  setSelectedTeacherDetails,
  setTeacherHistory,
  setTeacherHistoryLoading,
  setTeacherHistoryError,
  setReportView,
  historyRequestRef,
  teacherHistoryRequestRef,
  loadCircles,
  loadTeachers,
  loadScheduleSlots,
  loadAttendance,
  loadAdvertisingExpenses,
  loadOperatingExpenses,
}: CircleActionsOptions) {
  const openCircleCreate = () => {
    closeDetailLayers()
    setEditingCircle(null)
    setCircleForm(blankCircle())
    setCircleModal(true)
  }

  const openCircleEdit = (circle: Circle) => {
    closeDetailLayers()
    setEditingCircle(circle)
    setCircleForm({
      circleCode: circle.circleCode,
      name: circle.name,
      teacherId: circle.teacherId ?? '',
      monthlyFee: String(circle.monthlyFee ?? ''),
      scheduleText: circle.scheduleText ?? '',
      isActive: circle.isActive,
      startsOn: circle.startsOn,
    })
    setCircleModal(true)
  }

  const saveCircle = async (event: FormEvent<HTMLFormElement>, scheduleDrafts: CircleScheduleDraft[] = []) => {
    event.preventDefault()
    const normalizedDrafts = scheduleDrafts.map(row => ({
      dayOfWeek: Number(row.dayOfWeek),
      startsAt: row.startsAt.trim(),
      durationMinutes: Number(row.durationMinutes),
    }))
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
        body: JSON.stringify({
          ...circleForm,
          circleCode: circleForm.circleCode.trim() || null,
          teacherId: circleForm.teacherId || null,
          ...(has('finance.read') && has('finance.edit') ? { monthlyFee: Number(circleForm.monthlyFee) } : {}),
          scheduleText: circleForm.scheduleText.trim() || null,
          startsOn: circleForm.startsOn,
        }),
      })
      const scheduleErrors: string[] = []
      for (const row of normalizedDrafts) {
        try {
          await request('/api/schedule-slots', {
            method: 'POST',
            body: JSON.stringify({ circleId: savedCircle.id, dayOfWeek: row.dayOfWeek, startsAt: row.startsAt, durationMinutes: row.durationMinutes }),
          })
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

  const deleteCircle = async (circle: Circle) => {
    if (!await moveRecordToTrash('circle', circle.id, circle.name)) return
    await Promise.all([loadCircles(), loadScheduleSlots(), loadAdvertisingExpenses(), loadOperatingExpenses()])
    if (selectedCircle?.id === circle.id) setSelectedCircle(null)
  }

  const openCircleDetails = async (circle: Circle) => {
    if (!has('circles.read')) {
      setToast({ tone: 'error', text: 'حسابك لا يملك صلاحية عرض الحلقات.' })
      return
    }
    historyRequestRef.current += 1
    teacherHistoryRequestRef.current += 1
    setHistory(null)
    setSelectedStudent(null)
    setSelectedStudentPreview(null)
    setHistoryLoading(false)
    setSelectedTeacherDetails(null)
    setTeacherHistory(null)
    setTeacherHistoryLoading(false)
    setTeacherHistoryError('')
    setReportView(null)
    setStudentModal(false)
    setTeacherModal(false)
    setCircleModal(false)
    setEnrollmentModal(false)
    setPaymentModal(false)
    setChargeModal(false)
    setUserModal(false)
    setSelectedCircle(circle)
    setCircleDetailsLoading(true)
    setPage('circles')
    try {
      setCircleRoster(await request<CircleStudent[]>(`/api/circles/${circle.id}/students`))
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تحميل الطلاب في الحلقة.' })
    } finally {
      setCircleDetailsLoading(false)
    }
  }

  return { openCircleCreate, openCircleEdit, saveCircle, deleteCircle, openCircleDetails }
}
