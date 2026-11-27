import { describe, expect, it } from 'vitest'
import { minutesLabel } from './teacherFormat'

describe('minutesLabel (one duration unit per value)', () => {
  it('always uses the same minutes unit, even for whole hours', () => {
    expect(minutesLabel(0)).toBe('0 د')
    expect(minutesLabel(45)).toBe('45 د')
    expect(minutesLabel(60)).toBe('60 د')
    expect(minutesLabel(90)).toBe('90 د')
    expect(minutesLabel(125)).toBe('125 د')
  })

  it('never mixes an hour:minute format with the minutes format', () => {
    for (const minutes of [30, 60, 75, 90, 120, 600]) {
      const label = minutesLabel(minutes)
      expect(label).not.toMatch(/\d+:\d{2}/)
      expect(label).toMatch(/^\d+ د$/)
    }
  })

  it('clamps negative and fractional input without changing the unit', () => {
    expect(minutesLabel(-5)).toBe('0 د')
    expect(minutesLabel(59.9)).toBe('59 د')
  })
})
