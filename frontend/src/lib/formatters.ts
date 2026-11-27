import { CAIRO_TIME_ZONE } from './cairoDate'

const LOCALE = 'ar-EG-u-nu-latn'

export function formatNumber(value: number | null | undefined, maximumFractionDigits = 2) {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits }).format(value ?? 0)
}

/**
 * Date-only values carry no instant/timezone: parse them as UTC noon and render
 * the Cairo calendar date so the result never depends on the device timezone.
 */
export function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', timeZone: CAIRO_TIME_ZONE }).format(date)
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: CAIRO_TIME_ZONE }).format(date)
}

export function money(value: number | null | undefined) {
  return formatNumber(value) + ' ج.م'
}
