/** Decision for a failed offline attendance submission (P0-4). */
export type OutboxDecision = 'retry' | 'retry-after-login' | 'needs-review'

/**
 * Never delete a queued attendance mark because of an HTTP status.
 * - 401: keep it until the teacher signs in again (session expired, not invalid data).
 * - 408/425/429/5xx and network failures: retry with backoff.
 * - Other 4xx (400/403/404/409/422): keep it and flag it for an explicit human decision.
 */
export function classifyOutboxFailure(status?: number): OutboxDecision {
  if (typeof status !== 'number' || !Number.isFinite(status)) return 'retry'
  if (status === 401) return 'retry-after-login'
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'retry'
  if (status >= 400 && status < 500) return 'needs-review'
  return 'retry'
}

/** Exponential backoff for automatic retries, capped at 30 minutes. */
export function backoffRetryDelayMs(attempts: number): number {
  const safeAttempts = Math.max(1, Math.floor(attempts))
  return Math.min(30_000 * 2 ** (safeAttempts - 1), 30 * 60_000)
}
