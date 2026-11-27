import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addCairoDays,
  addCairoMonths,
  cairoDayKey,
  cairoInputDateTime,
  cairoInstant,
  cairoInstantFromInput,
  cairoMonthKey,
  cairoToday,
  cairoWallClock,
  cairoWeekday,
  cairoYearMonth,
  CAIRO_TIME_ZONE,
  dayKeyWeekday,
} from './cairoDate'

/** Naive implementation (device timezone) kept here only to prove the helper does NOT behave like it. */
function deviceDateString(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function deviceCanShiftTimezone(): boolean {
  try {
    vi.stubEnv('TZ', 'America/New_York')
    return new Date('2026-11-27T22:30:00Z').getDate() === 27
  } finally {
    vi.unstubAllEnvs()
  }
}

const timezoneSwitchingSupported = deviceCanShiftTimezone()

afterEach(() => {
  cleanupSyncedTimezones()
})

/** Every test that stubs TZ restores it immediately; this is a safety net for failures. */
function cleanupSyncedTimezones() {
  vi.unstubAllEnvs()
}

describe('Cairo day keys (the "two todays" root cause)', () => {
  it('derives the Cairo date at the midnight boundary where UTC still says yesterday', () => {
    // 2026-11-27 21:30Z = 2026-11-27 23:30 Cairo (UTC and Cairo agree on the day)
    expect(cairoDayKey(new Date('2026-11-27T21:30:00Z'))).toBe('2026-11-27')
    // 2026-11-27 22:30Z = 2026-11-28 00:30 Cairo (UTC/device-UTC still says 27)
    expect(cairoDayKey(new Date('2026-11-27T22:30:00Z'))).toBe('2026-11-28')
    expect(new Date('2026-11-27T22:30:00Z').toISOString().slice(0, 10)).toBe('2026-11-27')
    // 2026-11-28 21:30Z = 2026-11-28 23:30 Cairo
    expect(cairoDayKey(new Date('2026-11-28T21:30:00Z'))).toBe('2026-11-28')
  })

  it('does not follow the device timezone, unlike getFullYear/getMonth/getDate', () => {
    const instant = new Date('2026-11-27T22:30:00Z')
    expect(cairoDayKey(instant)).toBe('2026-11-28')
    if (!timezoneSwitchingSupported) return // environment ignores runtime TZ changes; Cairo assertions above still hold
    try {
      vi.stubEnv('TZ', 'America/New_York')
      expect(deviceDateString(instant)).toBe('2026-11-27')
      expect(cairoDayKey(instant)).toBe('2026-11-28')
      vi.stubEnv('TZ', 'Asia/Tokyo')
      expect(deviceDateString(instant)).toBe('2026-11-28')
      expect(cairoDayKey(instant)).toBe('2026-11-28')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('handles the DST start boundary (Cairo 2026-04-24 00:00 -> 01:00)', () => {
    // 2026-04-23 22:30Z = 2026-04-24 00:30 Cairo, still UTC+2 before the switch
    expect(cairoDayKey(new Date('2026-04-23T21:30:00Z'))).toBe('2026-04-23')
    expect(cairoDayKey(new Date('2026-04-23T22:30:00Z'))).toBe('2026-04-24')
    // after the switch Cairo is UTC+3: 21:30Z = 00:30 next day
    expect(cairoDayKey(new Date('2026-04-24T21:30:00Z'))).toBe('2026-04-25')
  })

  it('handles the DST end boundary (Cairo 2026-10-30 00:00 -> 23:00)', () => {
    expect(cairoDayKey(new Date('2026-10-28T21:30:00Z'))).toBe('2026-10-29')
    expect(cairoDayKey(new Date('2026-10-29T21:30:00Z'))).toBe('2026-10-29')
    expect(cairoDayKey(new Date('2026-10-29T22:30:00Z'))).toBe('2026-10-30')
  })

  it('rolls months and years on the Cairo calendar', () => {
    expect(cairoMonthKey(new Date('2026-11-27T21:30:00Z'))).toBe('2026-11')
    expect(cairoMonthKey(new Date('2026-11-27T22:30:00Z'))).toBe('2026-11')
    expect(cairoMonthKey(new Date('2026-12-31T22:30:00Z'))).toBe('2027-01')
    expect(cairoYearMonth(new Date('2026-12-31T22:30:00Z'))).toEqual({ year: 2027, month: 1 })
  })

  it('uses the Africa/Cairo timezone constant', () => {
    expect(CAIRO_TIME_ZONE).toBe('Africa/Cairo')
    expect(cairoToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('Cairo weekday and calendar arithmetic', () => {
  it('maps Cairo weekdays without device timezone getters', () => {
    expect(dayKeyWeekday('2026-11-27')).toBe(5) // Friday
    expect(dayKeyWeekday('2026-11-28')).toBe(6) // Saturday
    expect(cairoWeekday(new Date('2026-11-27T21:30:00Z'))).toBe(5)
    expect(cairoWeekday(new Date('2026-11-27T22:30:00Z'))).toBe(6)
  })

  it('adds calendar days across month, year and DST boundaries', () => {
    expect(addCairoDays('2026-11-27', 1)).toBe('2026-11-28')
    expect(addCairoDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addCairoDays('2026-04-23', 1)).toBe('2026-04-24')
    expect(addCairoDays('2026-04-24', -1)).toBe('2026-04-23')
    expect(addCairoDays('2026-10-29', 1)).toBe('2026-10-30')
    expect(addCairoDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('adds calendar months with day clamping', () => {
    expect(addCairoMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addCairoMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addCairoMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addCairoMonths('2024-01-31', 1)).toBe('2024-02-29')
  })
})

describe('Cairo wall-clock instants', () => {
  it('converts Cairo wall-clock time to the correct UTC instant (winter, UTC+2)', () => {
    expect(cairoInstant('2026-11-27', '23:30').toISOString()).toBe('2026-11-27T21:30:00.000Z')
    expect(cairoInstant('2026-11-27', '00:00').toISOString()).toBe('2026-11-26T22:00:00.000Z')
  })

  it('converts Cairo wall-clock time to the correct UTC instant (summer, UTC+3)', () => {
    expect(cairoInstant('2026-07-01', '00:30').toISOString()).toBe('2026-06-30T21:30:00.000Z')
    expect(cairoInstant('2026-04-24', '01:30').toISOString()).toBe('2026-04-23T22:30:00.000Z')
  })

  it('formats and re-parses datetime-local values in Cairo wall-clock time', () => {
    expect(cairoInputDateTime(new Date('2026-11-27T21:30:00Z'))).toBe('2026-11-27T23:30')
    expect(cairoInputDateTime(new Date('2026-11-27T22:30:00Z'))).toBe('2026-11-28T00:30')
    expect(cairoInstantFromInput('2026-11-27T23:30')?.toISOString()).toBe('2026-11-27T21:30:00.000Z')
    expect(cairoInstantFromInput('not-a-date')).toBeNull()
  })

  it('exposes Cairo wall-clock parts of an instant', () => {
    expect(cairoWallClock(new Date('2026-11-27T21:30:00Z'))).toMatchObject({ dayKey: '2026-11-27', hour: 23, minute: 30 })
    expect(cairoWallClock(new Date('2026-11-27T22:30:00Z'))).toMatchObject({ dayKey: '2026-11-28', hour: 0, minute: 30 })
  })

  it('rejects malformed day keys safely instead of throwing', () => {
    expect(cairoDayKey(new Date('invalid'))).toBe('')
    expect(Number.isNaN(cairoInstant('2026-11-27', 'bad').getTime())).toBe(true)
    expect(dayKeyWeekday('bad')).toBe(0)
    expect(addCairoDays('bad', 1)).toBe('bad')
  })
})
