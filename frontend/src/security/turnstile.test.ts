import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTurnstileConfig } from './turnstile'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('fetchTurnstileConfig', () => {
  it('returns disabled when the server has no Turnstile site key', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: false, siteKey: null }), { status: 200 })) as typeof fetch
    await expect(fetchTurnstileConfig('/api/auth/config')).resolves.toEqual({ enabled: false, siteKey: null })
  })

  it('returns the runtime site key when enabled', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: true, siteKey: 'runtime-site-key' }), { status: 200 })) as typeof fetch
    await expect(fetchTurnstileConfig('/api/auth/config')).resolves.toEqual({ enabled: true, siteKey: 'runtime-site-key' })
  })

  it('ignores an enabled flag without a site key', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: true, siteKey: '' }), { status: 200 })) as typeof fetch
    await expect(fetchTurnstileConfig('/api/auth/config')).resolves.toEqual({ enabled: false, siteKey: null })
  })

  it('rejects when the config endpoint is unavailable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 503 })) as typeof fetch
    await expect(fetchTurnstileConfig('/api/auth/config')).rejects.toThrow()
  })
})
