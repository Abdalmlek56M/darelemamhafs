import { describe, expect, it } from 'vitest'
import { ApiError, LOAD_FAILURE_MESSAGE, USER_MESSAGES, isArabicUserMessage, loginErrorMessage, normalizeUserMessage } from './userMessages'

const technical = /HTTP\s*\d|Failed to fetch|Internal Server Error|Exception|stack trace|Npgsql|PostgreSQL|SQLSTATE/i

describe('central user messages', () => {
  it('keeps Arabic server validation and business messages verbatim', () => {
    expect(normalizeUserMessage('سبب الإلغاء مطلوب وبين 3 و500 حرف.', 400)).toBe('سبب الإلغاء مطلوب وبين 3 و500 حرف.')
    expect(normalizeUserMessage('الصيغ المسموحة هي JPG وPNG وWebP فقط.', 400)).toBe('الصيغ المسموحة هي JPG وPNG وWebP فقط.')
    expect(isArabicUserMessage('تعذر حفظ البيانات.')).toBe(true)
  })

  it('replaces English, technical and empty messages', () => {
    expect(normalizeUserMessage('Failed to fetch')).toBe(USER_MESSAGES.network)
    expect(normalizeUserMessage('Internal Server Error', 500)).toBe(USER_MESSAGES.server)
    expect(normalizeUserMessage('HTTP 409', 409)).toBe(USER_MESSAGES.conflict)
    expect(normalizeUserMessage('', 503)).toBe(USER_MESSAGES.server)
    expect(normalizeUserMessage(null, 401)).toBe(USER_MESSAGES.unauthorized)
    expect(normalizeUserMessage(null, 429)).toBe(USER_MESSAGES.rate_limited)
  })

  it('separates read (load) failures from write (save) failures', () => {
    expect(normalizeUserMessage('Internal Server Error', 500, { intent: 'read' })).toBe(LOAD_FAILURE_MESSAGE)
    expect(normalizeUserMessage('', 502, { intent: 'read' })).toBe(LOAD_FAILURE_MESSAGE)
    expect(LOAD_FAILURE_MESSAGE).toMatch(/تعذر تحميل البيانات/)
    expect(LOAD_FAILURE_MESSAGE).not.toContain('لم يتم حفظ')
    expect(USER_MESSAGES.server).toContain('لم يتم حفظ التغييرات')
    // Writes keep the existing save-failure message (default intent).
    expect(normalizeUserMessage('Internal Server Error', 500)).toBe(USER_MESSAGES.server)
    expect(normalizeUserMessage('Internal Server Error', 500, { intent: 'write' })).toBe(USER_MESSAGES.server)
    // A real Arabic server message still wins for reads as well.
    expect(normalizeUserMessage('تعذر فتح ملف الإيصال المحفوظ.', 500, { intent: 'read' })).toBe('تعذر فتح ملف الإيصال المحفوظ.')
  })

  it('never returns a technical/English fallback', () => {
    for (const value of [normalizeUserMessage('TypeError: Failed to fetch', 0), normalizeUserMessage('', 500), normalizeUserMessage('HTTP 400', 400)]) {
      expect(value).not.toMatch(technical)
      expect(value).toMatch(/[\u0600-\u06FF]/)
    }
  })

  it('uses invalid-credentials for empty/English login 401, but keeps Arabic server 401', () => {
    expect(loginErrorMessage(401, USER_MESSAGES.unauthorized)).toBe(USER_MESSAGES.invalid_credentials)
    expect(loginErrorMessage(401, null, 'Unauthorized')).toBe(USER_MESSAGES.invalid_credentials)
    expect(loginErrorMessage(401, 'حسابك موقوف. تواصل مع الإدارة.', 'حسابك موقوف. تواصل مع الإدارة.')).toBe('حسابك موقوف. تواصل مع الإدارة.')
    expect(loginErrorMessage(401, null, 'اسم المستخدم مقفل مؤقتًا. حاول بعد قليل.')).toBe('اسم المستخدم مقفل مؤقتًا. حاول بعد قليل.')
    expect(USER_MESSAGES.unauthorized).not.toBe(USER_MESSAGES.invalid_credentials)
  })

  it('preserves the HTTP status on ApiError for retry/logout decisions', () => {
    const error = new ApiError(USER_MESSAGES.unauthorized, 401, 'unauthorized')
    expect(error.status).toBe(401)
    expect(error.message).toBe(USER_MESSAGES.unauthorized)
  })
})
