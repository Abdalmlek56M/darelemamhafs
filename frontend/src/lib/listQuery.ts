export type ListFilters = {
  page?: number
  pageSize?: number
  search?: string
  status?: string
  month?: string
}

/** Builds a legacy list query string; empty filters are omitted so the old shape stays intact. */
export function buildListQuery(filters: ListFilters): string {
  const params = new URLSearchParams()
  if (filters.page != null) params.set('page', String(filters.page))
  if (filters.pageSize != null) params.set('pageSize', String(filters.pageSize))
  const search = filters.search?.trim()
  if (search) params.set('search', search)
  const status = filters.status?.trim()
  if (status) params.set('status', status)
  if (filters.month?.trim()) params.set('month', filters.month.trim())
  const query = params.toString()
  return query ? `?${query}` : ''
}
