import { describe, expect, it } from 'vitest'
import { teacherLivePayableMinutes } from './teacherLivePay'

describe('teacherLivePayableMinutes', () => {
  it('pays zero for a zero-minute session (no 1-minute minimum)', () => {
    expect(teacherLivePayableMinutes(60, 0)).toBe(0)
    expect(teacherLivePayableMinutes(90, 0)).toBe(0)
  })

  it('pays the actual whole minutes when she ends early', () => {
    expect(teacherLivePayableMinutes(60, 30)).toBe(30)
    expect(teacherLivePayableMinutes(60, 59)).toBe(59)
    expect(teacherLivePayableMinutes(90, 75)).toBe(75)
  })

  it('pays the scheduled duration when she reaches or exceeds it', () => {
    expect(teacherLivePayableMinutes(60, 60)).toBe(60)
    expect(teacherLivePayableMinutes(60, 98)).toBe(60)
  })
})
