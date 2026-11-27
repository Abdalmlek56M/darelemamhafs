// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import EndEnrollmentDialog from './EndEnrollmentDialog'
import BulkEnrollmentDialog from './BulkEnrollmentDialog'
import type { DarApplicationContext } from '../../application/useDarApplication'
import type { Circle } from '../../domain/types'

const endingEnrollment = { enrollmentId: 'e1', studentId: 's1', studentName: 'مريم', circleId: 'cir1', circleName: 'حلقة النور' }

function endCtx() {
  return {
    endingEnrollment,
    endEnrollmentDate: '2026-11-28',
    saving: false,
    setEndingEnrollment: vi.fn(),
    setEndEnrollmentDate: vi.fn(),
    confirmEndEnrollment: vi.fn(() => Promise.resolve()),
  } as unknown as DarApplicationContext
}

const circle: Circle = {
  id: 'cir1',
  circleCode: 'CIR-1',
  name: 'حلقة النور',
  teacherId: null,
  teacherName: 'أسماء',
  monthlyFee: 300,
  scheduleText: null,
  isActive: true,
  activeStudentCount: 0,
  startsOn: '2026-01-01',
}

function bulkCtx() {
  return {
    has: () => false,
    students: [],
    circleRoster: [],
    saving: false,
    notifySystem: vi.fn(),
    openCircleDetails: vi.fn(() => Promise.resolve()),
  } as unknown as DarApplicationContext
}

beforeEach(() => {
  // 2026-11-27 22:30Z = 2026-11-28 00:30 Cairo; in New York it is still 2026-11-27.
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-27T22:30:00Z'))
  vi.stubEnv('TZ', 'America/New_York')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('enrollment date inputs use the Cairo date', () => {
  it('caps the end-enrollment date at Cairo today (not the device date)', () => {
    render(<EndEnrollmentDialog ctx={endCtx()} />)
    const input = document.querySelector('input[type="date"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.getAttribute('max')).toBe('2026-11-28')
  })

  it('defaults the bulk-enrollment start date to Cairo today', () => {
    render(<BulkEnrollmentDialog ctx={bulkCtx()} circle={circle} close={() => undefined} />)
    const input = document.querySelector('input[type="date"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.value).toBe('2026-11-28')
  })
})
