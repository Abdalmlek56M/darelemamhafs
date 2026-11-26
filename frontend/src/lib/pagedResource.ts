import type { PageMeta } from './pagination'

export type PagedState<T> = {
  items: T[]
  meta: PageMeta
  loading: boolean
  error: string | null
  requestId: number
}

export function initialPagedState<T>(pageSize: number): PagedState<T> {
  return { items: [], meta: { page: 1, pageSize, total: 0, truncated: false }, loading: false, error: null, requestId: 0 }
}

export function startLoad<T>(state: PagedState<T>, requestId: number): PagedState<T> {
  return { ...state, loading: true, error: null, requestId }
}

/** Applies a successful page only when it belongs to the latest request. */
export function resolvePage<T>(state: PagedState<T>, requestId: number, items: T[], meta: PageMeta): PagedState<T> {
  if (requestId !== state.requestId) return state
  return { items, meta, loading: false, error: null, requestId }
}

export function rejectPage<T>(state: PagedState<T>, requestId: number, error: string): PagedState<T> {
  if (requestId !== state.requestId) return state
  return { ...state, loading: false, error }
}

export function currentPage<T>(state: PagedState<T>): number {
  return state.meta.page
}
