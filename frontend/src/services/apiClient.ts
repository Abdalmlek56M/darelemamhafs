import { ApiError, isArabicUserMessage, normalizeUserMessage, userErrorCode } from '../lib/userMessages'

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

async function readError(response: Response) {
  let body: unknown = null
  try { body = await response.json() } catch { /* non-JSON error */ }
  const messages = serverMessages(body)
  // Keep the server's Arabic validation/business messages verbatim as required.
  const arabic = messages.filter(isArabicUserMessage)
  if (arabic.length > 0) return arabic.join(' ')
  const raw = messages.join(' ')
  return normalizeUserMessage(raw, response.status)
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(api(path), { ...init, headers, credentials: 'include', cache: 'no-store' })
  } catch (error) {
    throw new ApiError(normalizeUserMessage(error instanceof Error ? error.message : null, 0), 0, 'network')
  }
  if (!response.ok) {
    const message = await readError(response)
    throw new ApiError(message, response.status, userErrorCode(response.status, message))
  }
  if (response.status === 204) return undefined as T
  return await response.json() as T
}

export async function requestForm<T>(path: string, form: FormData): Promise<T> {
  let response: Response
  try {
    response = await fetch(api(path), { method: 'POST', body: form, credentials: 'include', cache: 'no-store' })
  } catch (error) {
    throw new ApiError(normalizeUserMessage(error instanceof Error ? error.message : null, 0), 0, 'network')
  }
  if (!response.ok) {
    const message = await readError(response)
    throw new ApiError(message, response.status, 'unknown')
  }
  return await response.json() as T
}
