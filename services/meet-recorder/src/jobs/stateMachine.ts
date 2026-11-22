/** Recording job state machine (mirrors Dar.Modules.Meet.Domain.MeetJobStates). */

export type JobStatus =
  | 'scheduled'
  | 'waiting'
  | 'joining'
  | 'live'
  | 'finalizing'
  | 'uploading'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'stalled'
  | 'partial'

const allowed: Record<JobStatus, readonly JobStatus[]> = {
  scheduled: ['waiting', 'joining', 'cancelled', 'failed'],
  waiting: ['joining', 'cancelled', 'failed', 'stalled'],
  joining: ['live', 'failed', 'cancelled', 'stalled'],
  live: ['finalizing', 'failed', 'partial', 'stalled'],
  finalizing: ['uploading', 'ready', 'failed', 'partial'],
  uploading: ['ready', 'failed'],
  partial: ['uploading', 'failed', 'ready'],
  stalled: ['joining', 'failed', 'cancelled'],
  ready: [],
  failed: ['waiting'],
  cancelled: []
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return allowed[from]?.includes(to) ?? false
}

export function isTerminal(status: JobStatus): boolean {
  return status === 'ready' || status === 'failed' || status === 'cancelled'
}

export function isActive(status: JobStatus): boolean {
  return status === 'waiting' || status === 'joining' || status === 'live' || status === 'finalizing' || status === 'uploading'
}

export function describeTransitions(from: JobStatus): readonly JobStatus[] {
  return allowed[from] ?? []
}
