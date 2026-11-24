import { describe, expect, it } from 'vitest'
import { backoffRetryDelayMs, classifyOutboxFailure } from './outboxPolicy'
import { isQueuedForUser, queueId } from './offlineOutbox'

describe('offline attendance outbox policy (P0-4)', () => {
  it('keeps the mark when the session expired (401) so it flushes after login', () => {
    expect(classifyOutboxFailure(401)).toBe('retry-after-login')
  })

  it('retries rate limiting (429) and transient server errors with backoff', () => {
    expect(classifyOutboxFailure(429)).toBe('retry')
    expect(classifyOutboxFailure(500)).toBe('retry')
    expect(classifyOutboxFailure(503)).toBe('retry')
    expect(classifyOutboxFailure(408)).toBe('retry')
    expect(classifyOutboxFailure(undefined)).toBe('retry')
  })

  it('never deletes a mark automatically when the response needs a human decision', () => {
    expect(classifyOutboxFailure(400)).toBe('needs-review')
    expect(classifyOutboxFailure(403)).toBe('needs-review')
    expect(classifyOutboxFailure(404)).toBe('needs-review')
    expect(classifyOutboxFailure(409)).toBe('needs-review')
    expect(classifyOutboxFailure(422)).toBe('needs-review')
  })

  it('grows the retry delay exponentially and caps it', () => {
    expect(backoffRetryDelayMs(1)).toBe(30_000)
    expect(backoffRetryDelayMs(2)).toBe(60_000)
    expect(backoffRetryDelayMs(3)).toBe(120_000)
    expect(backoffRetryDelayMs(20)).toBe(30 * 60_000)
  })
})

describe('offline attendance queue identity (P0-4)', () => {
  it('keys every queued mark by user + session so two accounts never share a queue', () => {
    expect(queueId('user-a', 'session-1')).toBe('user-a:session-1')
    expect(queueId('user-b', 'session-1')).toBe('user-b:session-1')
    expect(queueId('user-a', 'session-1')).not.toBe(queueId('user-b', 'session-1'))
    expect(isQueuedForUser({ userId: 'user-a' }, 'user-a')).toBe(true)
    expect(isQueuedForUser({ userId: 'user-a' }, 'user-b')).toBe(false)
  })
})
