import { describe, expect, it } from 'vitest'
import { idempotencyHeaders, newIdempotencyKey } from './idempotency'

describe('idempotency helpers', () => {
  it('creates a non-empty, unique key per call', () => {
    const first = newIdempotencyKey()
    const second = newIdempotencyKey()
    expect(first.length).toBeGreaterThan(8)
    expect(first).not.toBe(second)
  })

  it('adds the Idempotency-Key header and keeps extra headers', () => {
    const headers = idempotencyHeaders('abc-123', { 'content-type': 'application/json' })
    expect(headers.get('Idempotency-Key')).toBe('abc-123')
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('omits the header when no key is available', () => {
    const headers = idempotencyHeaders(null)
    expect(headers.has('Idempotency-Key')).toBe(false)
  })
})
