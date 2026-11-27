import { normalizeUserMessage } from '../lib/userMessages'
import { notifySessionExpired } from '../lib/sessionExpiry'

/** Authenticated JSON helper for the System and Maintenance screen. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!(init.body instanceof FormData) && init.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...init, headers })
  if (!response.ok) {
    let message = `تعذر تنفيذ الطلب (${response.status}).`
    try {
      const body = await response.json()
      message = body.message ?? body.detail ?? body.title ?? Object.values(body.errors ?? {})[0]?.toString() ?? message
    } catch { /* non-JSON error */ }
    if (response.status === 401) {
      // Expired session: clear the authenticated shell and return to login.
      notifySessionExpired()
      throw new Error(normalizeUserMessage(message, 401))
    }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
