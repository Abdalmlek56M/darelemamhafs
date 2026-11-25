const LOCALE = 'ar-EG-u-nu-latn'
const CAIRO = 'Africa/Cairo'

export function formatNumber(value: number | null | undefined, maximumFractionDigits = 2) {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits }).format(value ?? 0)
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: CAIRO }).format(date)
}

export function money(value: number | null | undefined) {
  return formatNumber(value) + ' ج.م'
}
