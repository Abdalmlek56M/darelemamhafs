// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import useDarApplication from './useDarApplication'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const branding = { brandName: 'دار الإمام حفص', logoDataUrl: null, facebookUrl: null, tiktokUrl: null, whatsappUrl: null }
const session = { id: 'u1', username: 'admin', displayName: 'المدير', permissionCodes: ['students.read'] }

let expired = false

function stubFetch(meStatus: number) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/api/branding')) return json(branding)
    if (url.includes('/api/setup/status')) return json({ needsInitialAdmin: false })
    if (url.includes('/api/auth/me')) return meStatus === 200 ? json(session) : json({ message: 'Unauthorized' }, 401)
    if (url.includes('/health')) return json({ status: 'ok', database: 'connected' })
    if (url.includes('/api/students')) return expired ? json({ message: 'Unauthorized' }, 401) : json([])
    return json({})
  }))
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  expired = false
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
  })
})

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('expired admin session (401)', () => {
  it('logs out client state and returns to the login screen with a session-expired message', async () => {
    stubFetch(200)
    const { result } = renderHook(() => useDarApplication())
    await waitFor(() => expect(result.current.gate).toBe('ready'))
    await waitFor(() => expect(result.current.students).toEqual([]))

    expired = true
    await act(async () => { await result.current.loadStudents().catch(() => undefined) })

    await waitFor(() => expect(result.current.gate).toBe('login'))
    expect(result.current.session).toBeNull()
    expect(result.current.toast?.text ?? '').toMatch(/انتهت جلستك/)
  })

  it('does not show a session-expired toast for the normal first visit without a session', async () => {
    stubFetch(401)
    const { result } = renderHook(() => useDarApplication())
    await waitFor(() => expect(result.current.gate).toBe('login'))
    expect(result.current.session).toBeNull()
    expect(result.current.toast?.text ?? '').not.toMatch(/انتهت جلستك/)
  })
})
