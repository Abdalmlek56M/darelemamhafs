// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CircleDialog from './CircleDialog'
import TeacherDialog from './TeacherDialog'
import { blankCircle, blankTeacher } from '../../domain/defaults'
import type { DarApplicationContext } from '../../application/useDarApplication'

describe('Mission 2 gender and circle type/children fields', () => {
  it('renders and updates circleType and isChildren in CircleDialog', () => {
    const setCircleForm = vi.fn()
    const ctx = {
      saving: false,
      circleModal: true,
      editingCircle: null,
      circleForm: blankCircle(),
      setCircleForm,
      setCircleModal: vi.fn(),
      saveCircle: vi.fn(),
      teachers: [],
      scheduleSlots: [],
      has: () => true,
    } as unknown as DarApplicationContext

    render(<CircleDialog ctx={ctx} />)
    expect(screen.getByLabelText('نوع الحلقة')).toBeTruthy()
    expect(screen.getByText('حلقة أطفال')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('نوع الحلقة'), { target: { value: 'individual' } })
    expect(setCircleForm).toHaveBeenCalled()
  })

  it('renders gender selector in TeacherDialog', () => {
    const setTeacherForm = vi.fn()
    const ctx = {
      saving: false,
      editingTeacher: null,
      teacherForm: blankTeacher(),
      setTeacherForm,
      setTeacherModal: vi.fn(),
      saveTeacher: vi.fn(),
      has: () => true,
    } as unknown as DarApplicationContext

    render(<TeacherDialog ctx={ctx} />)
    expect(screen.getByLabelText('الجنس')).toBeTruthy()
  })
})
