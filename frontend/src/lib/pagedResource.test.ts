import { describe, expect, it } from 'vitest'
import { initialPagedState, rejectPage, resolvePage, startLoad } from './pagedResource'

const meta = { page: 2, pageSize: 25, total: 60, truncated: false }

describe('paged resource state', () => {
  it('starts empty without loading or error', () => {
    const state = initialPagedState<string>(25)
    expect(state.items).toEqual([])
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
    expect(state.meta.pageSize).toBe(25)
  })

  it('keeps the latest request id when a load starts', () => {
    const state = startLoad(initialPagedState<string>(25), 4)
    expect(state.loading).toBe(true)
    expect(state.requestId).toBe(4)
  })

  it('applies the page that belongs to the latest request', () => {
    const loading = startLoad(initialPagedState<string>(25), 4)
    const resolved = resolvePage(loading, 4, ['a', 'b'], meta)
    expect(resolved.items).toEqual(['a', 'b'])
    expect(resolved.meta).toEqual(meta)
    expect(resolved.loading).toBe(false)
    expect(resolved.error).toBeNull()
  })

  it('ignores a stale success from an older request', () => {
    const loading = startLoad(initialPagedState<string>(25), 5)
    const stale = resolvePage(loading, 4, ['old'], meta)
    expect(stale).toBe(loading)
  })

  it('ignores a stale failure from an older request', () => {
    const loading = startLoad(initialPagedState<string>(25), 5)
    const stale = rejectPage(loading, 4, 'قديم')
    expect(stale).toBe(loading)
  })

  it('surfaces the error only for the latest request', () => {
    const loading = startLoad(initialPagedState<string>(25), 6)
    const failed = rejectPage(loading, 6, 'تعذر التحميل')
    expect(failed.loading).toBe(false)
    expect(failed.error).toBe('تعذر التحميل')
  })
})
