import { afterEach, describe, expect, it, vi } from 'vitest'
import { teacherApi } from './teacherApi'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks() })

describe('teacherApi error status', () => {
  it('preserves 401 status and returns Arabic session message', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 })) as typeof fetch
    await expect(teacherApi.me()).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/[\u0600-\u06FF]/) })
  })
})
