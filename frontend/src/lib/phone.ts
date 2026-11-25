const PHONE_ALLOWED = /^[0-9+()\-\s]*$/

export function sanitizePhoneInput(value: string): string {
  return value.replace(/[^0-9+()\-\s]/g, '').slice(0, 40)
}

export function isValidPhone(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length <= 40 && PHONE_ALLOWED.test(trimmed)
}
