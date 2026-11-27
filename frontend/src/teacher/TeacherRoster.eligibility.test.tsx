// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TeacherRoster from './TeacherRoster'
import type { RosterResponse, Slot } from './teacherTypes'

afterEach(() => {
  cleanup()
})

const baseSlot: Slot = {
  id: 'slot-1',
  circleId: 'circle-1',
  circleName: 'حلقة الفجر',
  startsAt: '08:00',
  endsAt: '09:00',
  durationMinutes: 60,
  studentCount: 4,
  canStart: true,
  isCurrent: true,
  isNext: false,
  minutesUntilStart: 0,
  lateMinutes: 0,
  sessionId: 'sess-1',
  sessionStatus: 'awaiting_attendance',
  startedAt: '2026-11-27T06:00:00Z',
  endedAt: '2026-11-27T07:00:00Z',
  actualDurationMinutes: 60,
  payableDurationMinutes: 60,
  payBasis: 'scheduled',
  overtimeMinutes: 0,
  undertimeMinutes: 0,
  note: null,
  attendanceId: null,
}

const mixedRoster: RosterResponse = {
  sessionId: 'sess-1',
  date: '2026-11-27',
  slotId: 'slot-1',
  students: [
    {
      enrollmentId: 'enr-eligible-1',
      studentId: 'stu-1',
      studentCode: 'ST-001',
      studentName: 'فاطمة المؤهلة',
      status: 'present',
      note: null,
      eligibleForDate: true,
      eligibilityReason: null,
      enrollmentStatus: 'active',
    },
    {
      enrollmentId: 'enr-eligible-2',
      studentId: 'stu-2',
      studentCode: 'ST-002',
      studentName: 'مريم المؤهلة',
      status: null,
      note: null,
      eligibleForDate: true,
      eligibilityReason: null,
      enrollmentStatus: 'active',
    },
    {
      enrollmentId: 'enr-ineligible-1',
      studentId: 'stu-3',
      studentCode: 'ST-003',
      studentName: 'سارة غير المؤهلة',
      status: null,
      note: null,
      eligibleForDate: false,
      eligibilityReason: 'not-active-on-date',
      enrollmentStatus: 'ended',
    },
    {
      enrollmentId: 'enr-paused-1',
      studentId: 'stu-4',
      studentCode: 'ST-004',
      studentName: 'خديجة المتوقفة',
      status: null,
      note: null,
      eligibleForDate: false,
      eligibilityReason: 'paused',
      enrollmentStatus: 'paused',
    },
  ],
}

describe('TeacherRoster B12 eligibility filtering', () => {
  it('counts, bulk-updates, and submits only eligibleForDate rows while rendering ineligible rows separately without buttons', async () => {
    const onSubmit = vi.fn(async (marks: { enrollmentId: string; status: 'present' | 'excused' | 'absent' }[]) => ({
      present: marks.filter((m) => m.status === 'present').length,
      excused: marks.filter((m) => m.status === 'excused').length,
      absent: marks.filter((m) => m.status === 'absent').length,
      total: marks.length,
    }))

    render(
      <TeacherRoster
        roster={mixedRoster}
        slot={baseSlot}
        endResult={null}
        hourlyRate={60}
        loading={false}
        busy={false}
        error={null}
        canEarnings={true}
        onBack={() => undefined}
        onSubmit={onSubmit}
        onDone={() => undefined}
      />,
    )

    // Counters must count only the 2 eligible students.
    expect(screen.getByText('2 حاضر')).toBeTruthy()
    expect(screen.getByText('0 بعذر')).toBeTruthy()
    expect(screen.getByText('0 غائب')).toBeTruthy()
    expect(screen.getByText('الإجمالي 2')).toBeTruthy()

    // Ineligible rows are rendered in a separate disabled section without status buttons, with exact reasons.
    expect(screen.queryByRole('group', { name: 'حالة سارة غير المؤهلة' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'حالة خديجة المتوقفة' })).toBeNull()
    expect(screen.getByText('الالتحاق لم يكن نشطًا في هذا التاريخ')).toBeTruthy()
    expect(screen.getByText('لا يمكن تسجيل حضور خلال فترة الإيقاف')).toBeTruthy()

    // Eligible rows still have status toggles.
    expect(screen.getByRole('group', { name: 'حالة فاطمة المؤهلة' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'حالة مريم المؤهلة' })).toBeTruthy()

    // Bulk action applies only to eligible rows.
    fireEvent.click(screen.getByRole('button', { name: 'الكل غائب' }))
    expect(screen.getByText('0 حاضر')).toBeTruthy()
    expect(screen.getByText('2 غائب')).toBeTruthy()
    expect(screen.getByText('الإجمالي 2')).toBeTruthy()

    // Submit sends only eligible enrollmentIds.
    const submitBtn = screen.getByRole('button', { name: /تسجيل الحضور/ })
    fireEvent.click(submitBtn)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith([
      { enrollmentId: 'enr-eligible-1', status: 'absent' },
      { enrollmentId: 'enr-eligible-2', status: 'absent' },
    ])

    // Confirm sheet renders cleanly after submit.
    const sheet = await screen.findByText('تم تسجيل الحلقة')
    expect(within(sheet.closest('.t-sheet') as HTMLElement).getByText('2')).toBeTruthy()
  })

  it('disables submit when all roster rows are ineligible', () => {
    const allIneligible: RosterResponse = {
      ...mixedRoster,
      students: mixedRoster.students.filter((s) => !s.eligibleForDate),
    }

    render(
      <TeacherRoster
        roster={allIneligible}
        slot={baseSlot}
        endResult={null}
        hourlyRate={60}
        loading={false}
        busy={false}
        error={null}
        canEarnings={false}
        onBack={() => undefined}
        onSubmit={vi.fn()}
        onDone={() => undefined}
      />,
    )

    expect(screen.getByText('الإجمالي 0')).toBeTruthy()
    const submitBtn = screen.getByRole('button', { name: /تسجيل الحضور/ }) as HTMLButtonElement
    expect(submitBtn.disabled).toBe(true)
  })
})
