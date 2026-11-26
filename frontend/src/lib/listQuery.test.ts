import { describe, expect, it } from 'vitest'
import { buildListQuery } from './listQuery'

describe('buildListQuery', () => {
  it('returns an empty string when no filter is set', () => {
    expect(buildListQuery({})).toBe('')
  })

  it('includes page and pageSize for server pagination', () => {
    expect(buildListQuery({ page: 2, pageSize: 50 })).toBe('?page=2&pageSize=50')
  })

  it('trims the search term and includes status and month', () => {
    expect(buildListQuery({ page: 1, pageSize: 50, search: '  سارة  ', status: 'active', month: '2026-11' }))
      .toBe('?page=1&pageSize=50&search=%D8%B3%D8%A7%D8%B1%D8%A9&status=active&month=2026-11')
  })

  it('omits blank search and status so totals stay unfiltered', () => {
    expect(buildListQuery({ page: 1, pageSize: 50, search: '   ', status: '' })).toBe('?page=1&pageSize=50')
  })
})
