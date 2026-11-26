import { describe, expect, it } from 'vitest'
import { clampPage, defaultMeta, MAX_PAGE_SIZE, normalizePageSize, pageCount, parsePageMeta } from './pagination'

function headers(values: Record<string, string>) {
  return new Headers(values)
}

describe('pagination meta', () => {
  it('reads all pagination headers from a legacy array response', () => {
    const meta = parsePageMeta(headers({
      'X-Total-Count': '12',
      'X-Page': '2',
      'X-Page-Size': '25',
      'X-Truncated': 'false',
    }), 12)
    expect(meta).toEqual({ page: 2, pageSize: 25, total: 12, truncated: false })
  })

  it('falls back to the returned count when headers are missing', () => {
    expect(parsePageMeta(headers({}), 7)).toEqual({ page: 1, pageSize: 25, total: 7, truncated: false })
  })

  it('marks truncation only for the explicit true header', () => {
    expect(parsePageMeta(headers({ 'X-Truncated': 'true' }), 25).truncated).toBe(true)
    expect(parsePageMeta(headers({ 'X-Truncated': 'false' }), 25).truncated).toBe(false)
  })

  it('computes page count and clamps out-of-range pages', () => {
    expect(pageCount(0, 25)).toBe(1)
    expect(pageCount(26, 25)).toBe(2)
    expect(clampPage(99, 26, 25)).toBe(2)
    expect(clampPage(0, 26, 25)).toBe(1)
    expect(clampPage(2, 0, 25)).toBe(1)
  })

  it('normalizes page sizes against the shared cap', () => {
    expect(normalizePageSize(undefined, 25)).toBe(25)
    expect(normalizePageSize(500, 50)).toBe(MAX_PAGE_SIZE)
    expect(normalizePageSize(0, 50)).toBe(50)
  })

  it('builds demo meta without pagination truth', () => {
    expect(defaultMeta(3)).toEqual({ page: 1, pageSize: 25, total: 3, truncated: false })
  })
})
