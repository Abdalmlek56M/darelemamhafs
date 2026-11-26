export type PageMeta = {
  page: number
  pageSize: number
  total: number
  truncated: boolean
}

export type PagedResponse<T> = { data: T; meta: PageMeta }

export const PORTAL_PAGE_SIZE = 25
export const ADMIN_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100

const HEADER_TOTAL = 'x-total-count'
const HEADER_PAGE = 'x-page'
const HEADER_PAGE_SIZE = 'x-page-size'
const HEADER_TRUNCATED = 'x-truncated'

function headerNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name)
  if (!raw) return null
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value >= 0 ? value : null
}

export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize))
}

export function clampPage(page: number, total: number, pageSize: number): number {
  const safe = Number.isFinite(page) ? Math.floor(page) : 1
  return Math.min(Math.max(1, safe || 1), pageCount(total, pageSize))
}

export function normalizePageSize(requested: number | undefined, fallback: number): number {
  const size = requested ?? fallback
  if (!Number.isFinite(size) || size <= 0) return fallback
  return Math.min(Math.floor(size), MAX_PAGE_SIZE)
}

/** Reads the shared pagination headers; falls back to safe defaults when absent. */
export function parsePageMeta(headers: Headers, returned: number, fallbackPageSize = PORTAL_PAGE_SIZE): PageMeta {
  const total = headerNumber(headers, HEADER_TOTAL) ?? Math.max(0, returned)
  const page = headerNumber(headers, HEADER_PAGE) ?? 1
  const pageSize = headerNumber(headers, HEADER_PAGE_SIZE) ?? fallbackPageSize
  const truncated = (headers.get(HEADER_TRUNCATED) ?? '').trim().toLowerCase() === 'true'
  return { page, pageSize: Math.max(1, pageSize), total, truncated }
}

export function defaultMeta(returned: number, page = 1, pageSize = PORTAL_PAGE_SIZE): PageMeta {
  return { page, pageSize, total: Math.max(0, returned), truncated: false }
}
