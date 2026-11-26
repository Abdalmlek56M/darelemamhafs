import { useEffect, useRef, useState } from 'react'
import { PORTAL_PAGE_SIZE, clampPage, normalizePageSize, pageCount, type PageMeta } from '../lib/pagination'
import { initialPagedState, rejectPage, resolvePage, startLoad, type PagedState } from '../lib/pagedResource'

export type PagedPage<T> = { items: T[]; meta: PageMeta }

export type PagedResource<T> = PagedState<T> & {
  page: number
  pageSize: number
  totalPages: number
  setPage: (page: number) => void
  reload: () => void
}

export type UsePagedResourceOptions<T> = {
  fetcher: (page: number, pageSize: number) => Promise<PagedPage<T>>
  /** Any change here resets the list to page 1 (search, filters, month, demo switch...). */
  deps: readonly unknown[]
  pageSize?: number
  enabled?: boolean
}

export function usePagedResource<T>({ fetcher, deps, pageSize = PORTAL_PAGE_SIZE, enabled = true }: UsePagedResourceOptions<T>): PagedResource<T> {
  const size = normalizePageSize(pageSize, PORTAL_PAGE_SIZE)
  const [page, setPageState] = useState(1)
  const [state, setState] = useState<PagedState<T>>(() => initialPagedState<T>(size))
  const [reloadKey, setReloadKey] = useState(0)
  const depsKey = JSON.stringify(deps)
  const knownDeps = useRef(depsKey)
  const requestSeq = useRef(0)

  useEffect(() => {
    if (knownDeps.current === depsKey) return
    knownDeps.current = depsKey
    setPageState(1)
  }, [depsKey])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    requestSeq.current += 1
    const requestId = requestSeq.current
    setState((current) => startLoad(current, requestId))
    fetcher(page, size)
      .then((result) => {
        if (cancelled) return
        setState((current) => resolvePage(current, requestId, result.items, result.meta))
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error && error.message ? error.message : 'تعذر تحميل البيانات.'
        setState((current) => rejectPage(current, requestId, message))
      })
    return () => { cancelled = true }
  }, [page, size, enabled, fetcher, reloadKey])

  const totalPages = pageCount(state.meta.total, size)

  useEffect(() => {
    if (state.meta.total > 0 && page > totalPages) setPageState(totalPages)
  }, [page, totalPages, state.meta.total])

  const setPage = (next: number) => setPageState(clampPage(next, state.meta.total, size))
  const reload = () => setReloadKey((value) => value + 1)

  return { ...state, page, pageSize: size, totalPages, setPage, reload }
}
