import { describe, expect, it } from 'vitest'
import { isValidPhone, sanitizePhoneInput } from './phone'

describe('phone validation', () => {
  it('keeps digits and supported separators only', () => {
    expect(sanitizePhoneInput('010ABC123')).toBe('010123')
    expect(sanitizePhoneInput('+20 101-234 (5678)')).toBe('+20 101-234 (5678)')
  })

  it('normalizes Arabic-Indic and Persian digits to ASCII', () => {
    expect(sanitizePhoneInput('٠١٠١٢٣٤٥٦٧٨')).toBe('01012345678')
    expect(sanitizePhoneInput('۰۱۰۱۲۳۴۵۶۷۸')).toBe('01012345678')
    expect(sanitizePhoneInput('٠١٠ABC١٢٣')).toBe('010123')
  })

  it('validates supported phone forms and empty values', () => {
    expect(isValidPhone('')).toBe(true)
    expect(isValidPhone('01012345678')).toBe(true)
    expect(isValidPhone('+20 101 234 5678')).toBe(true)
    expect(isValidPhone('010ABC123')).toBe(false)
    expect(isValidPhone('0101234567890123456789012345678901234567890')).toBe(false)
  })
})
