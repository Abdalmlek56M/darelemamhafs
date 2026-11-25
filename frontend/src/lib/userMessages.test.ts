import { describe, expect, it } from 'vitest'
import { ApiError, USER_MESSAGES, isArabicUserMessage, normalizeUserMessage } from './userMessages'

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

  it('never returns a technical/English fallback', () => {
    for (const value of [normalizeUserMessage('TypeError: Failed to fetch', 0), normalizeUserMessage('', 500), normalizeUserMessage('HTTP 400', 400)]) {
      expect(value).not.toMatch(technical)
      expect(value).toMatch(/[\u0600-\u06FF]/)
    }
  })

  it('preserves the HTTP status on ApiError for retry/logout decisions', () => {
    const error = new ApiError(USER_MESSAGES.unauthorized, 401, 'unauthorized')
    expect(error.status).toBe(401)
    expect(error.message).toBe(USER_MESSAGES.unauthorized)
  })
})
