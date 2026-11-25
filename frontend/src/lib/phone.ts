const PHONE_ALLOWED = /^[0-9+()\-\s]*$/
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'

function normalizeDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabic = ARABIC_INDIC_DIGITS.indexOf(digit)
    if (arabic >= 0) return String(arabic)
    return String(PERSIAN_DIGITS.indexOf(digit))
  })
}

export function sanitizePhoneInput(value: string): string {
  return normalizeDigits(value).replace(/[^0-9+()\-\s]/g, '').slice(0, 40)
}

export function isValidPhone(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length <= 40 && PHONE_ALLOWED.test(trimmed)
}
