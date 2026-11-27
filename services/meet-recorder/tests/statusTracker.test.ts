import { describe, expect, it } from 'vitest'
import { JobStatusTracker } from '../src/jobs/statusTracker.js'
import { isAdmitControlLabel } from '../src/meet/access.js'

describe('job status tracker (FINAL 1.23)', () => {
  it('follows the server state machine', () => {
    const tracker = new JobStatusTracker('joining')
    expect(tracker.tryAdvance('live')).toBe(true)
    expect(tracker.tryAdvance('finalizing')).toBe(true)
    expect(tracker.tryAdvance('ready')).toBe(true)
  })

  it('refuses invalid transitions instead of sending them', () => {
    const tracker = new JobStatusTracker('joining')
    expect(tracker.tryAdvance('ready')).toBe(false)
    expect(tracker.status).toBe('joining')
  })
})
