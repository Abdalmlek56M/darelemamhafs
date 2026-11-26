import { ApiError, isArabicUserMessage, normalizeUserMessage, userErrorCode } from '../lib/userMessages'
import { PORTAL_PAGE_SIZE, parsePageMeta, type PagedResponse } from '../lib/pagination'

const api = (path: string) => path

function serverMessages(body: unknown): string[] {
  if (!body || typeof body !== 'object') return []
  const record = body as Record<string, unknown>
  const values: string[] = []
  if (typeof record.message === 'string') values.push(record.message)
  if (record.errors && typeof record.errors === 'object') {
    for (const value of Object.values(record.errors as Record<string, unknown>)) {
      if (Array.isArray(value)) values.push(...value.filter((item): item is string => typeof item === 'string'))
      else if (typeof value === 'string') values.push(value)
    }
  }
  return values
}

type ParsedError = { message: string; serverMessage: string | null }

async function readError(response: Response): Promise<ParsedError> {
  let body: unknown = null
  try { body = await response.json() } catch { /* non-JSON error */ }
  const messages = serverMessages(body)
  // Keep the server's Arabic validation/business messages verbatim as required.
  const arabic = messages.filter(isArabicUserMessage)
  if (arabic.length > 0) {
    const message = arabic.join(' ')
    return { message, serverMessage: message }
  }
  const raw = messages.join(' ')
  return { message: normalizeUserMessage(raw, response.status), serverMessage: null }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(api(path), { ...init, headers, credentials: 'include', cache: 'no-store' })
  } catch (error) {
    throw new ApiError(normalizeUserMessage(error instanceof Error ? error.message : null, 0), 0, 'network')
  }
  if (!response.ok) {
    const parsed = await readError(response)
    throw new ApiError(parsed.message, response.status, userErrorCode(response.status, parsed.message), parsed.serverMessage ?? undefined)
  }
  return response
}

async function decode<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T
  return await response.json() as T
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return await decode<T>(await send(path, init))
}

/** Same request pipeline, but keeps the pagination headers (legacy arrays included). */
export async function requestPage<T>(path: string, init?: RequestInit, fallbackPageSize = PORTAL_PAGE_SIZE): Promise<PagedResponse<T>> {
  const response = await send(path, init)
  const data = await decode<T>(response)
  const record = data as unknown as Record<string, unknown> | null
  const returned = Array.isArray(data)
    ? data.length
    : record && typeof record.count === 'number'
      ? record.count
      : 0
  return { data, meta: parsePageMeta(response.headers, returned, fallbackPageSize) }
}

export async function requestForm<T>(path: string, form: FormData, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(api(path), { ...init, method: 'POST', body: form, credentials: 'include', cache: 'no-store' })
  } catch (error) {
    throw new ApiError(normalizeUserMessage(error instanceof Error ? error.message : null, 0), 0, 'network')
  }
  if (!response.ok) {
    const parsed = await readError(response)
    throw new ApiError(parsed.message, response.status, userErrorCode(response.status, parsed.message), parsed.serverMessage ?? undefined)
  }
  return await response.json() as T
}
