import { describe, expect, it } from 'vitest'
import { nextIdleState } from '../src/jobs/idle.js'

describe('idle stop (FINAL 1.21)', () => {
  it('needs several consecutive low readings', () => {
    const empty = { emptySince: null, lowStreak: 0 }
    const first = nextIdleState(empty, 1, 1000, 0, 3)
    expect(first.stop).toBe(false)
    const second = nextIdleState(first.state, 1, 2000, 0, 3)
    expect(second.stop).toBe(false)
    const third = nextIdleState(second.state, 1, 3000, 0, 3)
    expect(third.stop).toBe(true)
    expect(third.reason).toMatch(/3 consecutive/)
  })

  it('a single high reading or unknown read resets the streak', () => {
    const first = nextIdleState({ emptySince: null, lowStreak: 0 }, 1, 1000, 0, 3)
    const high = nextIdleState(first.state, 2, 2000, 0, 3)
    expect(high.stop).toBe(false)
    expect(high.state.lowStreak).toBe(0)
    const unknown = nextIdleState({ emptySince: 0, lowStreak: 2 }, null, 5000, 0, 3)
    expect(unknown.stop).toBe(false)
    expect(unknown.state).toEqual({ emptySince: null, lowStreak: 0 })
  })

  it('still enforces the idle duration window', () => {
    const state = { emptySince: 1000, lowStreak: 2 }
    expect(nextIdleState(state, 1, 5000, 60_000, 1).stop).toBe(false)
    expect(nextIdleState(state, 1, 70_000, 60_000, 1).stop).toBe(true)
  })
})
