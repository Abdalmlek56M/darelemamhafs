const api = (path: string) => path

async function readError(response: Response) {
  try { const body = await response.json(); if (typeof body.message === 'string') return body.message; if (body.errors && typeof body.errors === 'object') return Object.values(body.errors).flat().join(' '); return 'تعذر إتمام العملية. راجع البيانات وحاول مرة أخرى.' }
  catch { return response.status === 401 ? 'الجلسة انتهت أو بيانات الدخول غير صحيحة.' : response.status === 403 ? 'حسابك لا يملك الصلاحية المطلوبة.' : `تعذر إتمام الطلب (HTTP ${response.status}).` }
}
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(api(path), { ...init, headers, credentials: 'include', cache: 'no-store' })
  if (!response.ok) throw new Error(await readError(response))
  if (response.status === 204) return undefined as T
  return await response.json() as T
}
export async function requestForm<T>(path: string, form: FormData): Promise<T> { const response = await fetch(api(path), { method: 'POST', body: form, credentials: 'include', cache: 'no-store' }); if (!response.ok) throw new Error(await readError(response)); return await response.json() as T }
