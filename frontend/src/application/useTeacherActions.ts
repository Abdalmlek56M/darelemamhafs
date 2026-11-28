import type { FormEvent, MutableRefObject } from 'react'
import type { Notice, Teacher, TeacherForm, TeacherHistoryData } from '../domain/types'
import { blankTeacher } from '../domain/defaults'
import { request } from '../services/apiClient'

type TeacherActionsOptions = {
  has: (code: string) => boolean
  setToast: (notice: Notice) => void
  setSaving: (value: boolean) => void
  closeDetailLayers: () => void
  moveRecordToTrash: (entityType: string, entityId: string, displayName: string) => Promise<boolean>
  teacherHistory: TeacherHistoryData | null
  selectedTeacherDetails: Teacher | null
  editingTeacher: Teacher | null
  teacherForm: TeacherForm
  setEditingTeacher: (value: Teacher | null) => void
  setTeacherForm: (value: TeacherForm) => void
  setTeacherModal: (value: boolean) => void
  setStudentModal: (value: boolean) => void
  setCircleModal: (value: boolean) => void
  setEnrollmentModal: (value: boolean) => void
  setPaymentModal: (value: boolean) => void
  setChargeModal: (value: boolean) => void
  setUserModal: (value: boolean) => void
  setSelectedTeacherDetails: (value: Teacher | null) => void
  setTeacherHistory: (value: TeacherHistoryData | null) => void
  setTeacherHistoryLoading: (value: boolean) => void
  setTeacherHistoryError: (value: string) => void
  teacherHistoryRequestRef: MutableRefObject<number>
  loadTeachers: () => Promise<void>
  loadCircles: () => Promise<void>
}

/** Teacher profile drawer, notes, and teacher CRUD. */
export default function useTeacherActions({
  has,
  setToast,
  setSaving,
  closeDetailLayers,
  moveRecordToTrash,
  teacherHistory,
  selectedTeacherDetails,
  editingTeacher,
  teacherForm,
  setEditingTeacher,
  setTeacherForm,
  setTeacherModal,
  setStudentModal,
  setCircleModal,
  setEnrollmentModal,
  setPaymentModal,
  setChargeModal,
  setUserModal,
  setSelectedTeacherDetails,
  setTeacherHistory,
  setTeacherHistoryLoading,
  setTeacherHistoryError,
  teacherHistoryRequestRef,
  loadTeachers,
  loadCircles,
}: TeacherActionsOptions) {
  const openTeacherDetails = async (teacher: Teacher) => {
    closeDetailLayers()
    setStudentModal(false)
    setTeacherModal(false)
    setCircleModal(false)
    setEnrollmentModal(false)
    setPaymentModal(false)
    setChargeModal(false)
    setUserModal(false)
    const requestId = ++teacherHistoryRequestRef.current
    setSelectedTeacherDetails(teacher)
    setTeacherHistory(null)
    setTeacherHistoryLoading(true)
    setTeacherHistoryError('')
    try {
      const result = await request<TeacherHistoryData>(`/api/teachers/${teacher.id}/history`)
      if (teacherHistoryRequestRef.current === requestId) setTeacherHistory(result)
    } catch (error) {
      if (teacherHistoryRequestRef.current === requestId) {
        setTeacherHistoryError(error instanceof Error ? error.message : 'تعذر تحميل ملف المعلمة.')
      }
    } finally {
      if (teacherHistoryRequestRef.current === requestId) setTeacherHistoryLoading(false)
    }
  }

  const closeTeacherDetails = () => {
    teacherHistoryRequestRef.current += 1
    setSelectedTeacherDetails(null)
    setTeacherHistory(null)
    setTeacherHistoryLoading(false)
    setTeacherHistoryError('')
  }

  const addTeacherNote = async (teacherId: string, noteText: string) => {
    if (!noteText.trim()) return false
    try {
      await request(`/api/teachers/${teacherId}/notes`, { method: 'POST', body: JSON.stringify({ noteText: noteText.trim() }) })
      const teacher = teacherHistory?.teacher ?? selectedTeacherDetails
      if (teacher?.id === teacherId) await openTeacherDetails(teacher)
      setToast({ tone: 'success', text: 'تم حفظ الملاحظة في سجل المعلمة.' })
      return true
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ ملاحظة المعلمة.' })
      return false
    }
  }

  const deleteTeacherNote = async (teacherId: string, noteId: string) => {
    const note = teacherHistory?.notes.find(n => n.id === noteId)
    if (!await moveRecordToTrash('teacher-note', noteId, note?.noteText.slice(0, 80) || 'ملاحظة المعلمة')) return
    const teacher = teacherHistory?.teacher ?? selectedTeacherDetails
    if (teacher?.id === teacherId) await openTeacherDetails(teacher)
  }

  const openTeacherCreate = () => {
    closeDetailLayers()
    setEditingTeacher(null)
    setTeacherForm(blankTeacher())
    setTeacherModal(true)
  }

  const openTeacherEdit = (teacher: Teacher) => {
    closeDetailLayers()
    setEditingTeacher(teacher)
    setTeacherForm({
      teacherCode: teacher.teacherCode,
      fullName: teacher.fullName,
      phone: teacher.phone ?? '',
      hourlyRate: String(teacher.hourlyRate ?? ''),
      status: teacher.status,
      notes: teacher.notes ?? '',
      gender: teacher.gender ?? '',
    })
    setTeacherModal(true)
  }

  const saveTeacher = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    const canEditFinancials = has('finance.read') && has('finance.edit')
    try {
      await request(editingTeacher ? `/api/teachers/${editingTeacher.id}` : '/api/teachers', {
        method: editingTeacher ? 'PUT' : 'POST',
        body: JSON.stringify({
          teacherCode: teacherForm.teacherCode.trim() || null,
          fullName: teacherForm.fullName,
          phone: teacherForm.phone.trim() || null,
          status: teacherForm.status,
          notes: teacherForm.notes.trim() || null,
          gender: teacherForm.gender || null,
          ...(!editingTeacher && teacherForm.username?.trim()
            ? { username: teacherForm.username.trim(), password: teacherForm.password ?? '' }
            : {}),
          // Never send the string-backed form value: the API binds decimal? and rejects
          // numeric strings, and non-finance users must omit the field entirely.
          ...(canEditFinancials ? { hourlyRate: Number(teacherForm.hourlyRate) } : {}),
        }),
      })
      setTeacherForm(blankTeacher())
      setTeacherModal(false)
      await Promise.all([loadTeachers(), loadCircles()])
      setToast({ tone: 'success', text: editingTeacher ? 'تم تعديل بيانات المعلمة.' : 'تمت إضافة المعلمة.' })
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ المعلمة.' })
    } finally { setSaving(false) }
  }

  const deleteTeacher = async (teacher: Teacher) => {
    if (!await moveRecordToTrash('teacher', teacher.id, teacher.fullName)) return
    await Promise.all([loadTeachers(), loadCircles()])
  }

  return {
    openTeacherDetails,
    closeTeacherDetails,
    addTeacherNote,
    deleteTeacherNote,
    openTeacherCreate,
    openTeacherEdit,
    saveTeacher,
    deleteTeacher,
  }
}
