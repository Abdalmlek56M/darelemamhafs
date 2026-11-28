// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import WeeklyScheduleView from './WeeklyScheduleView'
import type { ScheduleSlot } from '../domain/types'

const slots: ScheduleSlot[] = [
  { id: '1', circleId: 'c1', circleName: 'حلقة الفجر', teacherId: 't1', teacherName: 'أ. فاطمة', dayOfWeek: 0, startsAt: '08:00', durationMinutes: 60, isActive: true, circleIsActive: true },
  { id: '2', circleId: 'c2', circleName: 'حلقة العصر', teacherId: 't2', teacherName: 'أ. مريم', dayOfWeek: 2, startsAt: '16:30', durationMinutes: 45, isActive: true, circleIsActive: true },
  { id: '3', circleId: 'c3', circleName: 'حلقة موقوفة', teacherId: 't3', teacherName: 'أ. سارة', dayOfWeek: 2, startsAt: '10:00', durationMinutes: 60, isActive: false, circleIsActive: true },
]

describe('WeeklyScheduleView', () => {
  it('groups active slots by day of week and excludes inactive slots', () => {
    render(<WeeklyScheduleView slots={slots} />)
    expect(screen.getByText('2 حصة أسبوعية نشطة')).toBeTruthy()
    expect(screen.getByText('حلقة الفجر')).toBeTruthy()
    expect(screen.getByText('حلقة العصر')).toBeTruthy()
    expect(screen.queryByText('حلقة موقوفة')).toBeNull()
  })
})
