import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, formatNumber, money } from './formatters'

const arabicDigits = /[٠-٩۰-۹]/

describe('display formatters', () => {
  it('keeps date-only values on their Cairo calendar date and uses Arabic months with Latin digits', () => {
    expect(formatDate('2026-11-25')).toContain('نوفمبر')
    expect(formatDate('2026-11-25')).toContain('25')
    expect(formatDate('2026-11-25')).not.toMatch(arabicDigits)
    expect(formatDate('2026-11-25')).not.toContain('T12:00:00')
  })

  it('formats datetime in Africa/Cairo with Latin digits', () => {
    const value = formatDateTime('2026-11-24T23:30:00Z')
    expect(value).toContain('نوفمبر')
    expect(value).toContain('25')
    expect(value).toContain('1:30')
    expect(value).not.toMatch(arabicDigits)
  })

  it('formats numbers and money with Latin digits', () => {
    expect(formatNumber(1234.5)).toContain('1,234')
    expect(money(1234.5)).toContain('1,234')
    expect(money(1234.5)).toContain('ج.م')
    expect(money(1234.5)).not.toMatch(arabicDigits)
  })
})
