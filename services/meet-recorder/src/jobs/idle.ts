/**
 * FINAL 1.21: the participant-count scrape is fragile. Do not cut a live lesson on one bad
 * reading: require a minimum number of consecutive low counts and keep the timing guard.
 */

export type IdleState = {
  emptySince: number | null
  lowStreak: number
}

export type IdleDecision = {
  state: IdleState
  stop: boolean
  reason: string | null
}

export function nextIdleState(
  state: IdleState,
  participants: number | null,
  nowMs: number,
  idleStopMs: number,
  confirmTicks: number
): IdleDecision {
  // Unknown reads must never stop a lesson and reset the "empty" window.
  if (participants === null) {
    return { state: { emptySince: null, lowStreak: 0 }, stop: false, reason: null }
  }

  if (participants > 1) {
    return { state: { emptySince: null, lowStreak: 0 }, stop: false, reason: null }
  }

  const lowStreak = state.lowStreak + 1
  const emptySince = state.emptySince ?? nowMs
  const confirmed = lowStreak >= Math.max(1, confirmTicks) && nowMs - emptySince >= idleStopMs
  return {
    state: { emptySince, lowStreak },
    stop: confirmed,
    reason: confirmed
      ? `idle stop: ${lowStreak} consecutive low participant readings (last=${participants})`
      : null
  }
}
