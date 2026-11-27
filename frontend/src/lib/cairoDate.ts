/**
 * Single source of truth for calendar dates in the frontend.
 *
 * The product runs on the Africa/Cairo calendar. Every "today"/month/weekday
 * derivation must go through this module (Intl with an explicit timeZone) and
 * never through `new Date()` local getters (`getFullYear`, `getMonth`, `getDate`,
 * `getDay`) or `toISOString().slice(0, 10)`; those follow the device timezone or
 * UTC and caused the "two todays" bug near midnight.
 */
export const CAIRO_TIME_ZONE = 'Africa/Cairo'

/** en-CA + Latin digits yields the ISO-like YYYY-MM-DD shape in the given zone. */
const DAY_KEY_LOCALE = 'en-CA-u-nu-latn'
const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_PATTERN = /^(\d{1,2}):(\d{2})/

const dayKeyFormatter = new Intl.DateTimeFormat(DAY_KEY_LOCALE, {
  timeZone: CAIRO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const partsFormatter = new Intl.DateTimeFormat('en-US-u-nu-latn', {
  timeZone: CAIRO_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

type CairoWallClock = { dayKey: string; hour: number; minute: number; second: number }

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime())
}

function wallClock(value: Date): CairoWallClock {
  const parts = partsFormatter.formatToParts(value)
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value ?? 0)
  const hour = pick('hour')
  return {
    dayKey: `${String(pick('year')).padStart(4, '0')}-${String(pick('month')).padStart(2, '0')}-${String(pick('day')).padStart(2, '0')}`,
    // Some ICU builds report midnight as 24 with h23; normalize it.
    hour: hour === 24 ? 0 : hour,
    minute: pick('minute'),
    second: pick('second'),
  }
}

/** Milliseconds that Africa/Cairo is ahead of UTC at the given instant. */
function cairoOffsetMs(instant: Date): number {
  const clock = wallClock(instant)
  const [year, month, day] = clock.dayKey.split('-').map(Number)
  const wallAsUtc = Date.UTC(year, month - 1, day, clock.hour, clock.minute, clock.second)
  const instantWithoutMs = instant.getTime() - instant.getMilliseconds()
  return wallAsUtc - instantWithoutMs
}

/** Cairo calendar day of an instant (or "now"), shaped YYYY-MM-DD. */
export function cairoDayKey(value: Date = new Date()): string {
  if (!isValidDate(value)) return ''
  return dayKeyFormatter.format(value)
}

/** Today's date in Africa/Cairo — use it for every default/today/max date input. */
export function cairoToday(): string {
  return cairoDayKey()
}

/** Current billing month in Africa/Cairo, shaped YYYY-MM. */
export function cairoMonthKey(value: Date = new Date()): string {
  return cairoDayKey(value).slice(0, 7)
}

export function cairoYearMonth(value: Date = new Date()): { year: number; month: number } {
  const key = cairoDayKey(value)
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) }
}

/** Weekday of a YYYY-MM-DD Cairo calendar date: 0 = Sunday … 6 = Saturday. */
export function dayKeyWeekday(dayKey: string): number {
  const match = DAY_KEY_PATTERN.exec(dayKey)
  if (!match) return 0
  // UTC noon keeps the calendar date stable for every device timezone.
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)).getUTCDay()
}

/** Weekday of an instant on the Cairo calendar: 0 = Sunday … 6 = Saturday. */
export function cairoWeekday(value: Date = new Date()): number {
  return dayKeyWeekday(cairoDayKey(value))
}

/** Add/subtract whole Cairo calendar days. Pure day-key arithmetic: no device timezone involved. */
export function addCairoDays(dayKey: string, days: number): string {
  const match = DAY_KEY_PATTERN.exec(dayKey)
  if (!match) return dayKey
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
  date.setUTCDate(date.getUTCDate() + Math.trunc(days))
  return date.toISOString().slice(0, 10)
}

/** Add/subtract whole Cairo calendar months, clamping the day (31 Jan + 1 = 28/29 Feb). */
export function addCairoMonths(dayKey: string, months: number): string {
  const match = DAY_KEY_PATTERN.exec(dayKey)
  if (!match) return dayKey
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1 + Math.trunc(months)
  const targetYear = year + Math.floor(monthIndex / 12)
  const targetMonth = ((monthIndex % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const targetDay = Math.min(Number(match[3]), lastDay)
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`
}

/** Cairo wall-clock parts of an instant (used for reminders/countdowns). */
export function cairoWallClock(value: Date = new Date()): CairoWallClock {
  return wallClock(value)
}

/** The instant when a Cairo wall-clock date/time happens. DST-aware. */
export function cairoInstant(dayKey: string, time = '00:00'): Date {
  const dayMatch = DAY_KEY_PATTERN.exec(dayKey)
  const timeMatch = TIME_PATTERN.exec(time ?? '')
  if (!dayMatch || !timeMatch) return new Date(NaN)
  const year = Number(dayMatch[1])
  const month = Number(dayMatch[2])
  const day = Number(dayMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  let instant = wallAsUtc
  // Two passes converge for both DST switches (offset before/after the switch).
  for (let pass = 0; pass < 2; pass++) instant = wallAsUtc - cairoOffsetMs(new Date(instant))
  return new Date(instant)
}

/** `datetime-local` input value for an instant, expressed in Cairo wall-clock time. */
export function cairoInputDateTime(value: Date = new Date()): string {
  const clock = wallClock(value)
  const pad = (unit: number) => String(unit).padStart(2, '0')
  return `${clock.dayKey}T${pad(clock.hour)}:${pad(clock.minute)}`
}

/** Parse a `datetime-local` value as Cairo wall-clock time (returns null when malformed). */
export function cairoInstantFromInput(value: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2})/.exec(value ?? '')
  if (!match) return null
  const instant = cairoInstant(match[1], match[2])
  return Number.isNaN(instant.getTime()) ? null : instant
}
