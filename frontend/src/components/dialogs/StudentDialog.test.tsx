// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import StudentDialog from './StudentDialog'
import type { DarApplicationContext } from '../../application/useDarApplication'
import type { Student, StudentForm, StudentStatus } from '../../domain/types'
import { INVALID_NEW_STUDENT_STATUS_MESSAGE } from '../../lib/validation'

function studentForm(status: StudentStatus): StudentForm {
  return {
    studentCode: '',
    fullName: 'طالبة جديدة',
    ageYears: '',
    phone: '',
    guardianName: '',
    guardianPhone: '',
    joinedOn: '2026-11-28',
    status,
    notes: '',
  }
}

const existingStudent: Student = {
  id: 's1',
  studentCode: 'STD-1',
  fullName: 'طالبة جديدة',
  ageYears: null,
  phone: null,
  guardianName: null,
  guardianPhone: null,
  joinedOn: '2026-11-28',
  status: 'withdrawn',
  notes: null,
  createdAt: '2026-11-28T00:00:00Z',
  updatedAt: '2026-11-28T00:00:00Z',
  circleNames: '',
  currentMonthDue: null,
  currentMonthPaid: null,
  currentMonthPaymentStatus: null,
}

function makeCtx({ status = 'active' as StudentStatus, editingStudent = null as Student | null } = {}) {
  return {
    studentForm: studentForm(status),
    editingStudent,
    saving: false,
    setStudentModal: vi.fn(),
    setStudentForm: vi.fn(),
    setToast: vi.fn(),
    saveStudent: vi.fn(() => Promise.resolve()),
  } as unknown as DarApplicationContext
}

afterEach(() => cleanup())

describe('StudentDialog create-status validation', () => {
  it('rejects creating a student whose initial status is withdrawn', () => {
    const ctx = makeCtx({ status: 'withdrawn' })
    render(<StudentDialog ctx={ctx} />)
    fireEvent.click(screen.getByRole('button', { name: /حفظ الطالب/ }))
    expect(ctx.saveStudent).not.toHaveBeenCalled()
    expect(ctx.setToast).toHaveBeenCalledWith({ tone: 'error', text: INVALID_NEW_STUDENT_STATUS_MESSAGE })
    expect(screen.getByRole('alert').textContent).toBe(INVALID_NEW_STUDENT_STATUS_MESSAGE)
  })

  it('rejects creating a student whose initial status is archived', () => {
    const ctx = makeCtx({ status: 'archived' })
    render(<StudentDialog ctx={ctx} />)
    fireEvent.click(screen.getByRole('button', { name: /حفظ الطالب/ }))
    expect(ctx.saveStudent).not.toHaveBeenCalled()
    expect(ctx.setToast).toHaveBeenCalledWith({ tone: 'error', text: INVALID_NEW_STUDENT_STATUS_MESSAGE })
  })

  it('creates a student with an active status', () => {
    const ctx = makeCtx({ status: 'active' })
    render(<StudentDialog ctx={ctx} />)
    fireEvent.click(screen.getByRole('button', { name: /حفظ الطالب/ }))
    expect(ctx.saveStudent).toHaveBeenCalledTimes(1)
    expect(ctx.setToast).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps editing an existing withdrawn student allowed', () => {
    const ctx = makeCtx({ status: 'withdrawn', editingStudent: existingStudent })
    render(<StudentDialog ctx={ctx} />)
    fireEvent.click(screen.getByRole('button', { name: /حفظ التعديلات/ }))
    expect(ctx.saveStudent).toHaveBeenCalledTimes(1)
    expect(ctx.setToast).not.toHaveBeenCalled()
  })
})
