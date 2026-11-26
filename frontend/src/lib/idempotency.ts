let counter = 0

/** FINAL 0.1: one stable key per money-write attempt; retries must reuse it. */
export function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  counter += 1
  return `dar-${Date.now()}-${counter}`
}

/** Adds the idempotency header when a key is present; the server replays the first row. */
export function idempotencyHeaders(key: string | null | undefined, extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  if (key) headers.set('Idempotency-Key', key)
  return headers
}
