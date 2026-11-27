import { afterEach, describe, expect, it, vi } from 'vitest'
import { blankAdExpense, blankCharge, blankCircle, blankEnrollment, blankOperatingExpense, blankStudent } from './defaults'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('blank-form date defaults', () => {
  it('defaults every date field to the Cairo date at the midnight boundary, not the device date', () => {
    // 2026-11-27 22:30Z = 2026-11-28 00:30 Cairo; in New York (UTC-5) it is still 2026-11-27 17:30.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-27T22:30:00Z'))
    vi.stubEnv('TZ', 'America/New_York')

    expect([
      blankStudent().joinedOn,
      blankCircle().startsOn,
      blankEnrollment().startsOn,
      blankAdExpense().startDate,
      blankOperatingExpense().expenseDate,
    ]).toEqual(Array(5).fill('2026-11-28'))
  })

  it('defaults the billing month to the Cairo month at a month boundary', () => {
    // 2026-11-30 22:30Z = 2026-12-01 00:30 Cairo; the UTC/device-UTC month is still 2026-11.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-30T22:30:00Z'))
    vi.stubEnv('TZ', 'America/New_York')
    expect(blankCharge().billingMonth).toBe('2026-12')
  })
})
