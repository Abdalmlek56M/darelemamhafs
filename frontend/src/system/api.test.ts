import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { notifySessionExpired, setSessionExpiryListener } from '../lib/sessionExpiry'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); setSessionExpiryListener(null) })

describe('system admin api 401 handling', () => {
  it('notifies the session-expiry listener and throws the session message', async () => {
    const listener = vi.fn()
    setSessionExpiryListener(listener)
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 })) as typeof fetch
    await expect(api('/api/admin/settings')).rejects.toThrow(/انتهت جلستك/)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not log out for non-401 failures and keeps the server message', async () => {
    const listener = vi.fn()
    setSessionExpiryListener(listener)
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'تعذر تحميل الإعدادات.' }), { status: 500 })) as typeof fetch
    await expect(api('/api/admin/settings')).rejects.toThrow('تعذر تحميل الإعدادات.')
    expect(listener).not.toHaveBeenCalled()
  })

  it('notifySessionExpired is safe without a registered listener', () => {
    setSessionExpiryListener(null)
    expect(() => notifySessionExpired()).not.toThrow()
  })
})
