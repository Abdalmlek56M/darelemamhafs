export type UserErrorCode =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'rate_limited'
  | 'server'
  | 'unknown'
  | 'invalid_credentials'

export const USER_MESSAGES: Record<UserErrorCode, string> = {
  network: 'تعذر الاتصال بالخادم. تأكد من الإنترنت وحاول مرة أخرى.',
  timeout: 'استغرق الطلب وقتًا طويلًا. حاول مرة أخرى.',
  unauthorized: 'انتهت جلستك. سجّل الدخول من جديد.',
  forbidden: 'لا تملك الصلاحية لتنفيذ هذا الإجراء. تواصل مع المدير.',
  not_found: 'العنصر المطلوب غير موجود. حدّث الصفحة وحاول مرة أخرى.',
  validation: 'راجع البيانات المدخلة وحاول مرة أخرى.',
  conflict: 'تعذر الحفظ لأن البيانات تغيرت. حدّث الصفحة وحاول مرة أخرى.',
  rate_limited: 'محاولات كثيرة. انتظر دقيقة ثم حاول مرة أخرى.',
  server: 'حدث خطأ مؤقت في الخادم. لم يتم حفظ التغييرات، حاول بعد قليل.',
  unknown: 'تعذر إتمام العملية. حاول مرة أخرى.',
  invalid_credentials: 'اسم المستخدم أو كلمة السر غير صحيحة.',
}

/** Errors that carry both the original HTTP status and a safe Arabic display message. */
export class ApiError extends Error {
  status: number
  code: UserErrorCode

  serverMessage?: string

  constructor(message: string, status: number, code: UserErrorCode, serverMessage?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.serverMessage = serverMessage
  }
}

const NETWORK = /failed to fetch|networkerror|network request failed|load failed|fetch failed|socket hang up|err_connection|offline/i
const TIMEOUT = /timeout|timed out|abort/i
const TECHNICAL = /http\s*\d|internal server error|problemdetails|exception|stack\s*trace|typeerror|referenceerror|npgsql|postgres|sqlstate|could not determine|json parse|<html/i

/** Server validation messages in Arabic may contain harmless Latin acronyms (JPG/PNG/WebP). */
export function isArabicUserMessage(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (!text || !/[\u0600-\u06FF]/.test(text)) return false
  return !TECHNICAL.test(text)
}

export function userErrorCode(status?: number, message?: unknown): UserErrorCode {
  const text = typeof message === 'string' ? message : ''
  if (NETWORK.test(text)) return 'network'
  if (TIMEOUT.test(text)) return 'timeout'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 400 || status === 422) return 'validation'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate_limited'
  if (typeof status === 'number' && status >= 500) return 'server'
  if (typeof status === 'number' && status >= 400) return 'validation'
  return 'unknown'
}

/** Failures while loading (GET) must not claim that the user's changes were not saved. */
export const LOAD_FAILURE_MESSAGE = 'تعذر تحميل البيانات. حاول مرة أخرى بعد قليل.'

/** Keep Arabic messages from the server; replace English/technical/empty messages with the central table. */
export function normalizeUserMessage(message: unknown, status?: number, options?: { intent?: 'read' | 'write' }): string {
  if (isArabicUserMessage(message)) return message.trim()
  const code = userErrorCode(status, message)
  if (code === 'server' && options?.intent === 'read') return LOAD_FAILURE_MESSAGE
  return USER_MESSAGES[code]
}

/** Login 401 means bad credentials, not an expired session. */
export function loginErrorMessage(status?: number, message?: unknown, serverMessage?: string | null): string {
  if (status === 401) {
    // A real Arabic server message (suspended/locked account, etc.) wins.
    // Empty/English/technical 401 falls back to the generic credentials message.
    return isArabicUserMessage(serverMessage) ? serverMessage.trim() : USER_MESSAGES.invalid_credentials
  }
  return normalizeUserMessage(message, status)
}
