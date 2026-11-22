import type { FormEvent, MutableRefObject } from 'react'
import type {
  Circle,
  HistoryData,
  Notice,
  ReportSnapshot,
  Student,
  StudentForm,
  StudentStatus,
  Teacher,
  TeacherHistoryData,
} from '../domain/types'
import { blankStudent } from '../domain/defaults'
import { statusLabels } from '../domain/labels'
import { localDateString } from '../lib/dates'
import { request } from '../services/apiClient'
import { confirmAction } from '../components/common/confirmService'

type SelectedStudentPreview = { id: string; fullName: string; studentCode: string }

type StudentActionsOptions = {
  has: (code: string) => boolean
  setToast: (notice: Notice) => void
  setSaving: (value: boolean) => void
  closeDetailLayers: () => void
  moveRecordToTrash: (entityType: string, entityId: string, displayName: string) => Promise<boolean>
  students: Student[]
  selectedStudent: Student | null
  history: HistoryData | null
  historyNote: string
  setHistoryNote: (value: string) => void
  editingStudent: Student | null
  studentForm: StudentForm
  setEditingStudent: (value: Student | null) => void
  setStudentForm: (value: StudentForm) => void
  setStudentModal: (value: boolean) => void
  setTeacherModal: (value: boolean) => void
  setCircleModal: (value: boolean) => void
  setEnrollmentModal: (value: boolean) => void
  setPaymentModal: (value: boolean) => void
  setChargeModal: (value: boolean) => void
  setUserModal: (value: boolean) => void
  setHistory: (value: HistoryData | null) => void
  setHistoryLoading: (value: boolean) => void
  setSelectedStudent: (value: Student | null) => void
  setSelectedStudentPreview: (value: SelectedStudentPreview | null) => void
  setSelectedCircle: (value: Circle | null) => void
  setReportView: (value: ReportSnapshot | null) => void
  setSelectedTeacherDetails: (value: Teacher | null) => void
  setTeacherHistory: (value: TeacherHistoryData | null) => void
  setTeacherHistoryLoading: (value: boolean) => void
  setTeacherHistoryError: (value: string) => void
  historyRequestRef: MutableRefObject<number>
  teacherHistoryRequestRef: MutableRefObject<number>
  loadStudents: () => Promise<void>
  loadCircles: () => Promise<void>
  loadCollections: (month?: string) => Promise<void>
}

/** Student create/edit/status/delete plus the student history drawer. */
export default function useStudentActions({
  has,
  setToast,
  setSaving,
  closeDetailLayers,
  moveRecordToTrash,
  students,
  selectedStudent,
  history,
  historyNote,
  setHistoryNote,
  editingStudent,
  studentForm,
  setEditingStudent,
  setStudentForm,
  setStudentModal,
  setTeacherModal,
  setCircleModal,
  setEnrollmentModal,
  setPaymentModal,
  setChargeModal,
  setUserModal,
  setHistory,
  setHistoryLoading,
  setSelectedStudent,
  setSelectedStudentPreview,
  setSelectedCircle,
  setReportView,
  setSelectedTeacherDetails,
  setTeacherHistory,
  setTeacherHistoryLoading,
  setTeacherHistoryError,
  historyRequestRef,
  teacherHistoryRequestRef,
  loadStudents,
  loadCircles,
  loadCollections,
}: StudentActionsOptions) {
  const openStudentCreate = () => {
    closeDetailLayers()
    setEditingStudent(null)
    setStudentForm(blankStudent())
    setStudentModal(true)
  }

  const duplicateStudent = (student: Student) => {
    if (!has('students.create')) {
      setToast({ tone: 'error', text: 'حسابك لا يملك صلاحية إضافة طالب جديد.' })
      return
    }
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

  const openStudentEdit = (student: Student) => {
    closeDetailLayers()
    setEditingStudent(student)
    setStudentForm({
      studentCode: student.studentCode,
      fullName: student.fullName,
      ageYears: student.ageYears == null ? '' : String(student.ageYears),
      phone: student.phone ?? '',
      guardianName: student.guardianName ?? '',
      guardianPhone: student.guardianPhone ?? '',
      joinedOn: student.joinedOn.slice(0, 10),
      status: student.status,
      notes: student.notes ?? '',
    })
    setStudentModal(true)
  }

  const saveStudent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    try {
      await request(editingStudent ? `/api/students/${editingStudent.id}` : '/api/students', {
        method: editingStudent ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...studentForm,
          ageYears: studentForm.ageYears.trim() ? Number(studentForm.ageYears) : null,
          studentCode: studentForm.studentCode.trim() || null,
          phone: studentForm.phone.trim() || null,
          guardianName: studentForm.guardianName.trim() || null,
          guardianPhone: studentForm.guardianPhone.trim() || null,
          notes: studentForm.notes.trim() || null,
        }),
      })
      setStudentModal(false)
      await loadStudents()
      if (selectedStudent?.id) await openHistory(selectedStudent.id)
      setToast({ tone: 'success', text: editingStudent ? 'تم حفظ تعديلات الطالب.' : 'تمت إضافة الطالب وحفظ بياناته.' })
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ الطالب.' })
    } finally { setSaving(false) }
  }

  const changeStudentStatus = async (student: Student, status: StudentStatus) => {
    if (status === student.status) return
    if (status === 'withdrawn' && !(await confirmAction({ title: 'تغيير حالة الطالب', message: `الانسحاب النهائي للطالب ${student.fullName} سينهي جميع التحاقات الطالب النشطة والمتوقفة في كل الحلقات بتاريخ اليوم، مع الاحتفاظ بالحضور والتحصيلات والسجل التاريخي. لا يمكن التراجع عن ذلك بتغيير الحالة فقط. هل تريد المتابعة؟`, confirmLabel: 'متابعة' }))) return
    if (status === 'paused' && !(await confirmAction({ title: 'إيقاف الالتحاق', message: `سيتم تغيير الحالة الإدارية لملف ${student.fullName} فقط. لن تتوقف التحاقاته تلقائيًا؛ أوقف كل التحاق من تفاصيل الحلقة إذا كان المطلوب إيقاف الدراسة في حلقة بعينها. هل تريد المتابعة؟`, confirmLabel: 'متابعة' }))) return
    try {
      await request(`/api/students/${student.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...(status === 'withdrawn' ? { effectiveOn: localDateString() } : {}) }),
      })
      await Promise.all([loadStudents(), loadCircles(), loadCollections()])
      setToast({
        tone: 'success',
        text: status === 'withdrawn'
          ? `تم تسجيل الانسحاب النهائي لـ${student.fullName} وإنهاء جميع التحاقاته مع الاحتفاظ بالتاريخ.`
          : `تم تغيير حالة ${student.fullName} إلى ${statusLabels[status]}.`,
      })
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تغيير الحالة.' })
    }
  }

  const deleteStudent = async (student: Student) => {
    const moved = await moveRecordToTrash('student', student.id, student.fullName)
    if (!moved) return
    await loadStudents()
    if (selectedStudent?.id === student.id) {
      setSelectedStudent(null)
      setSelectedStudentPreview(null)
      setHistory(null)
      setHistoryLoading(false)
    }
  }

  const openHistory = async (id: string, fallback?: { id: string; fullName: string; studentCode: string }) => {
    const requestId = ++historyRequestRef.current
    teacherHistoryRequestRef.current += 1
    const knownStudent = students.find(student => student.id === id) ?? null
    const preview = knownStudent
      ? { id: knownStudent.id, fullName: knownStudent.fullName, studentCode: knownStudent.studentCode }
      : (fallback?.id === id ? fallback : null)
    setSelectedCircle(null)
    setReportView(null)
    setSelectedTeacherDetails(null)
    setTeacherHistory(null)
    setTeacherHistoryLoading(false)
    setTeacherHistoryError('')
    setStudentModal(false)
    setTeacherModal(false)
    setCircleModal(false)
    setEnrollmentModal(false)
    setPaymentModal(false)
    setChargeModal(false)
    setUserModal(false)
    setHistory(null)
    setHistoryNote('')
    setSelectedStudent(knownStudent)
    setSelectedStudentPreview(preview)
    setHistoryLoading(true)
    try {
      const result = await request<HistoryData>(`/api/students/${id}/history`)
      if (historyRequestRef.current !== requestId) return
      setHistory(result)
      setSelectedStudent(result.student)
      setSelectedStudentPreview({ id: result.student.id, fullName: result.student.fullName, studentCode: result.student.studentCode })
    } catch (error) {
      if (historyRequestRef.current === requestId) {
        setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر فتح السجل التاريخي.' })
      }
    } finally {
      if (historyRequestRef.current === requestId) setHistoryLoading(false)
    }
  }

  const closeHistory = () => {
    historyRequestRef.current += 1
    setHistory(null)
    setSelectedStudent(null)
    setSelectedStudentPreview(null)
    setHistoryLoading(false)
    setHistoryNote('')
  }

  const addStudentNote = async () => {
    if (!history || !historyNote.trim()) return
    try {
      await request(`/api/students/${history.student.id}/notes`, { method: 'POST', body: JSON.stringify({ noteText: historyNote }) })
      setHistoryNote('')
      await openHistory(history.student.id)
      setToast({ tone: 'success', text: 'تم حفظ الملاحظة في سجل الطالب.' })
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ الملاحظة.' })
    }
  }

  const deleteStudentNote = async (studentId: string, noteId: string) => {
    const note = history?.notes.find(n => n.id === noteId)
    if (!await moveRecordToTrash('student-note', noteId, note?.noteText.slice(0, 80) || 'ملاحظة الطالب')) return
    await openHistory(studentId)
  }

  return {
    openStudentCreate,
    duplicateStudent,
    openStudentEdit,
    saveStudent,
    changeStudentStatus,
    deleteStudent,
    openHistory,
    closeHistory,
    addStudentNote,
    deleteStudentNote,
  }
}