/**
 * Cooperative shutdown flag.
 *
 * systemd sends SIGTERM on restart/deploy. A recording must not be killed mid-flight:
 * the job loop checks this flag, finalises the MP4 and reports the result, so a deploy
 * can never lose a session or leave a stale `live` row behind.
 */
let stopping = false
let reason: string | null = null

export function requestShutdown(signal: string): void {
  if (!stopping) reason = signal
  stopping = true
}

export function isStopping(): boolean {
  return stopping
}

export function shutdownReason(): string | null {
  return reason
}
