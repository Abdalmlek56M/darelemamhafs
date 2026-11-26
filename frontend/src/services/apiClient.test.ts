import { afterEach, describe, expect, it, vi } from 'vitest'
import { request, requestPage } from './apiClient'

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

describe('apiClient pagination', () => {
  it('keeps the legacy array body and reads the pagination headers', async () => {
    const responseHeaders = { 'X-Total-Count': '12', 'X-Page': '2', 'X-Page-Size': '5', 'X-Truncated': 'false' }
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'a' }, { id: 'b' }]), { status: 200, headers: responseHeaders })) as typeof fetch
    const page = await requestPage<{ id: string }[]>('/api/teachers?page=2&pageSize=5')
    expect(page.data).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(page.meta).toEqual({ page: 2, pageSize: 5, total: 12, truncated: false })
  })

  it('reads the envelope count when headers are absent', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ count: 2, students: [{ id: 'a' }] }), { status: 200 })) as typeof fetch
    const page = await requestPage<{ count: number; students: { id: string }[] }>('/api/v1/supervisor/students?page=1&pageSize=25')
    expect(page.meta).toMatchObject({ page: 1, pageSize: 25, total: 2 })
  })
})
