// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import TeacherHistory from './TeacherHistory'
import { teacherApi } from './teacherApi'
import type { TeacherHistoryAttendance, TeacherHistorySession } from './teacherCalendarTypes'

const session: TeacherHistorySession = {
  id: 's1',
  date: '2026-11-20',
  circleName: 'حلقة النور',
  status: 'completed',
  startedAt: '2026-11-20T16:00:00+02:00',
  endedAt: '2026-11-20T17:05:00+02:00',
  scheduledMinutes: 60,
  actualMinutes: 65,
  payableMinutes: 60,
  payBasis: 'scheduled',
  overtimeMinutes: 5,
  undertimeMinutes: 0,
  note: null,
  presentStudents: 3,
  totalStudents: 3,
}

const attendance: TeacherHistoryAttendance = {
  id: 'a1',
  date: '2026-11-20',
  circleName: 'حلقة النور',
  status: 'present',
  durationMinutes: 90,
  payableAmount: null,
  note: null,
  markedAt: '2026-11-20T17:05:00+02:00',
}

function mockHistory() {
  vi.spyOn(teacherApi, 'teacherHistoryPage').mockResolvedValue({
    data: { sessions: [session], attendance: [attendance], logins: [], sessionTotal: 1, attendanceTotal: 1 },
    meta: { page: 1, pageSize: 25, total: 1, truncated: false },
  })
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('TeacherHistory duration labels', () => {
  it('uses one minutes unit for every duration in the same session row', async () => {
    mockHistory()
    render(<TeacherHistory onBack={() => undefined} />)
    expect(await screen.findByText(/المجدولة:/)).toBeTruthy()
    const row = screen.getByText(/المجدولة:/).closest('.t-history-card') as HTMLElement
    const durationRow = row.querySelectorAll('.t-history-meta')[1]
    const labels = Array.from(durationRow.querySelectorAll('span')).map((span) => span.textContent)
    expect(labels).toEqual(['المجدولة: 60 د', 'الفعلي: 65 د', 'المحتسب: 60 د'])
  })

  it('uses the minutes unit for the attendance duration too', async () => {
    mockHistory()
    render(<TeacherHistory onBack={() => undefined} />)
    expect(await screen.findByText(/المدة:/)).toBeTruthy()
    const row = screen.getByText(/المدة:/).closest('.t-history-card') as HTMLElement
    const duration = row.querySelector('.t-history-meta span')
    expect(duration?.textContent).toBe('المدة: 90 د')
  })
})
