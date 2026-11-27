import { formatTime12 } from '../lib/dates'
import { CAIRO_TIME_ZONE } from '../lib/cairoDate'

export function money(value: number | null | undefined) {
  return `${(value ?? 0).toFixed(2)} ج.م`
}

/** One unit per value: every duration is shown in minutes, never as hours:minutes. */
export function minutesLabel(totalMinutes: number) {
  const minutes = Math.max(0, Math.floor(totalMinutes))
  return `${minutes} د`
}

export function elapsedMinutes(startedAt: string | null | undefined) {
  if (!startedAt) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000))
}

export function localTime(value: string) {
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: CAIRO_TIME_ZONE }).format(new Date(value))
}

export function localDate(value: string) {
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', timeZone: CAIRO_TIME_ZONE }).format(new Date(`${value}T12:00:00Z`))
}

export function enrollmentStatusLabel(value: string) {
  return { active: 'نشطة', paused: 'موقوفة', ended: 'منتهية' }[value] ?? value
}

export function timeRange(start: string, end: string) {
  return `${formatTime12(start)} – ${formatTime12(end)}`
}