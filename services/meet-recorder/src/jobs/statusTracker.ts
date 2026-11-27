import type { JobStatus } from './stateMachine.js'
import { canTransition } from './stateMachine.js'

/**
 * FINAL 1.23: the state machine existed but nothing used it. The bot now guards every
 * status report through it, so it can never send an invalid transition to Dar.Api.
 */
export class JobStatusTracker {
  private current: JobStatus

  constructor(initial: JobStatus) {
    this.current = initial
  }

  get status(): JobStatus {
    return this.current
  }

  tryAdvance(next: JobStatus): boolean {
    if (this.current === next) return true
    if (!canTransition(this.current, next)) return false
    this.current = next
    return true
  }
}
