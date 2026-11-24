import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { teacherApi } from './teacherApi'

const realFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

describe('teacher portal request header', () => {
  it('adds X-Dar-Portal: teacher to every teacherApi request', async () => {
    await teacherApi.me()
    await teacherApi.submit('session-1', [])
    await teacherApi.notifications('all')
    await teacherApi.supervisorUnpaid('2026-11')

    const calls = (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit?]> } }).mock.calls
    expect(calls.length).toBe(4)
    for (const [, init] of calls) {
      const headers = new Headers(init?.headers)
      expect(headers.get('X-Dar-Portal')).toBe('teacher')
    }
  })
})
