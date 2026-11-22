import { describe, expect, it } from 'vitest'
import { canTransition, describeTransitions, isActive, isTerminal, type JobStatus } from '../src/jobs/stateMachine.js'

describe('recording job state machine', () => {
  it('allows the happy path only', () => {
    expect(canTransition('scheduled', 'joining')).toBe(true)
    expect(canTransition('joining', 'live')).toBe(true)
    expect(canTransition('live', 'finalizing')).toBe(true)
    expect(canTransition('finalizing', 'uploading')).toBe(true)
    expect(canTransition('uploading', 'ready')).toBe(true)
  })

  it('rejects backward and unknown transitions', () => {
    expect(canTransition('ready', 'live')).toBe(false)
    expect(canTransition('cancelled', 'joining')).toBe(false)
    expect(canTransition('uploading', 'live')).toBe(false)
    expect(canTransition('scheduled', 'ready')).toBe(false)
  })

  it('marks terminal and active states', () => {
    expect(isTerminal('ready')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
    expect(isTerminal('live')).toBe(false)
    expect(isActive('joining')).toBe(true)
    expect(isActive('ready')).toBe(false)
  })

  it('lets a failed job be retried once', () => {
    expect(canTransition('failed', 'waiting')).toBe(true)
    expect(describeTransitions('failed')).toEqual(['waiting'])
  })

  it('has no transitions out of ready', () => {
    expect(describeTransitions('ready' satisfies JobStatus)).toEqual([])
  })
})
