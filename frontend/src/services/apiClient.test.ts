import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from './apiClient'

const realFetch = globalThis.fetch

afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks() })

describe('apiClient error normalization', () => {
  it('keeps the status and Arabic server validation message', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'سبب الإلغاء مطلوب وبين 3 و500 حرف.' }), { status: 400 })) as typeof fetch
    await expect(request('/api/test')).rejects.toMatchObject({ status: 400, message: 'سبب الإلغاء مطلوب وبين 3 و500 حرف.' })
  })

  it('maps English 500 bodies to an Arabic server message but keeps status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Internal Server Error' }), { status: 500 })) as typeof fetch
    await expect(request('/api/test')).rejects.toMatchObject({ status: 500, message: expect.stringMatching(/[\u0600-\u06FF]/) })
  })

  it('maps network failures to a retry-safe status 0 and Arabic message', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as typeof fetch
    await expect(request('/api/test')).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/[\u0600-\u06FF]/) })
  })
})
