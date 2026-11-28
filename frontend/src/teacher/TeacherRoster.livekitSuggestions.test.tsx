// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TeacherRoster from './TeacherRoster'
import type { RosterResponse, Slot } from './teacherTypes'

vi.mock('../room/roomApi', () => ({
  roomApi: {
    sessionSuggestedAttendance: vi.fn(async () => ({
      roomId: 'r-1',
      teacherAttendedMinutes: 45,
      students: [
        { studentId: 's-1', userId: 'u-1', attendedMinutes: 40, suggestedStatus: 'present' },
        { studentId: 's-2', userId: 'u-2', attendedMinutes: 0, suggestedStatus: 'absent' },
      ],
    })),
  },
}))

const slot: Slot = {
  id: 'slot-1',
  circleId: 'c-1',
  circleName: 'حلقة الفجر',
  startsAt: '08:00',
  endsAt: '09:00',
  durationMinutes: 60,
  studentCount: 2,
  canStart: false,
  isCurrent: true,
  isNext: false,
  minutesUntilStart: 0,
  lateMinutes: 0,
  sessionId: 'sess-1',
  sessionStatus: 'awaiting_attendance',
  startedAt: '2026-11-28T06:00:00Z',
  endedAt: '2026-11-28T06:45:00Z',
  actualDurationMinutes: 45,
  payableDurationMinutes: 45,
  payBasis: 'actual',
  overtimeMinutes: 0,
  undertimeMinutes: 15,
  note: null,
  attendanceId: null,
}

const roster: RosterResponse = {
  sessionId: 'sess-1',
  date: '2026-11-28',
  slotId: 'slot-1',
  students: [
    { enrollmentId: 'e-1', studentId: 's-1', studentCode: 'ST-1', studentName: 'مريم', enrollmentStatus: 'active', eligibleForDate: true, eligibilityReason: null, status: null, note: null },
    { enrollmentId: 'e-2', studentId: 's-2', studentCode: 'ST-2', studentName: 'سارة', enrollmentStatus: 'active', eligibleForDate: true, eligibilityReason: null, status: null, note: null },
  ],
}

describe('TeacherRoster LiveKit attendance suggestions (Mission 5)', () => {
  it('shows attended minutes from the LiveKit room and applies suggestions on click while keeping manual submit intact', async () => {
    const onSubmit = vi.fn(async () => ({ present: 1, excused: 0, absent: 1, total: 2 }))
    render(
      <TeacherRoster
        roster={roster}
        slot={slot}
        endResult={null}
        hourlyRate={100}
        loading={false}
        busy={false}
        error={null}
        canEarnings={false}
        onBack={vi.fn()}
        onSubmit={onSubmit}
        onDone={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText(/40 د في الغرفة/)).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'تطبيق اقتراحات الغرفة' }))
    fireEvent.click(screen.getByRole('button', { name: /تسجيل الحضور/ }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith([
        { enrollmentId: 'e-1', status: 'present' },
        { enrollmentId: 'e-2', status: 'absent' },
      ])
    })
  })
})
