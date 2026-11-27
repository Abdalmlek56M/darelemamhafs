import { describe, expect, it } from 'vitest'
import { dateLabel, statusLabel, statusTone } from './supervisorFormat'

describe('supervisor date labels', () => {
  it('formats saved instants on their Cairo calendar date, not the UTC date', () => {
    // 2026-11-27 22:30Z = 2026-11-28 00:30 Cairo
    expect(dateLabel('2026-11-27T22:30:00Z')).toBe('28/11/2026')
    expect(dateLabel('2026-11-27T21:30:00Z')).toBe('27/11/2026')
  })

  it('keeps date-only values as their own Cairo calendar date', () => {
    expect(dateLabel('2026-11-28')).toBe('28/11/2026')
    expect(dateLabel('2026-11-27')).toBe('27/11/2026')
    expect(dateLabel(null)).toBe('—')
    expect(dateLabel('')).toBe('—')
  })
})

describe('supervisor attendance status labels', () => {
  it('labels every attendance/session state used by the supervisor UI', () => {
    expect(statusLabel('present')).toBe('حاضرة')
    expect(statusLabel('excused')).toBe('بعذر')
    expect(statusLabel('missing')).toBe('لم تسجل')
    expect(statusLabel('awaiting_attendance')).toBe('بانتظار الحضور')
    expect(statusLabel('completed')).toBe('مكتملة')
  })

  it('maps tones for present/absent/warning/live states', () => {
    expect(statusTone('present')).toContain('ok')
    expect(statusTone('absent')).toContain('bad')
    expect(statusTone('excused')).toContain('gold')
    expect(statusTone('in_progress')).toContain('live')
  })
})
