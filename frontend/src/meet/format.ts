import type { MeetEvent, MeetFilter, MeetRecordingMode } from './types'

const CAIRO = 'Africa/Cairo'

/** Calendar times are stored in UTC and always displayed in Africa/Cairo (docs/01). */
export function cairoDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    timeZone: CAIRO,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function cairoTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    timeZone: CAIRO,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function cairoDayKey(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function addDays(base: Date, days: number): Date {
  const next = new Date(base)
  next.setDate(next.getDate() + days)
  return next
}

export const filterLabels: Record<MeetFilter, string> = {
  all: 'الكل',
  linked: 'مرتبطة بحلقة',
  unlinked: 'غير مرتبطة',
  recording: 'ستُسجَّل',
  cancelled: 'ملغاة',
}

export const recordingModeLabels: Record<MeetRecordingMode, string> = {
  inherit: 'حسب اختيار الحلقة',
  force: 'تسجيل دائمًا',
  exclude: 'عدم التسجيل',
}

export function eventStatusLabel(event: MeetEvent): string {
  if (event.googleStatus === 'cancelled') return 'ملغى'
  if (event.googleStatus === 'tentative') return 'مبدئي'
  return 'مؤكد'
}

export function eventBadgeClass(event: MeetEvent): string {
  if (event.googleStatus === 'cancelled') return 'status-pill status-archived'
  return event.recordingEligible ? 'status-pill status-active' : 'status-pill status-archived'
}

export function recordingLabel(event: MeetEvent): string {
  if (event.googleStatus === 'cancelled') return 'ملغى'
  if (event.recordingMode === 'exclude') return 'مستبعد'
  if (event.recordingEligible) return 'سيُسجَّل'
  if (event.recordingMode === 'force') return 'إلزامي (بانتظار الربط)'
  return event.circleId ? 'الحلقة غير مختارة' : 'بانتظار الربط'
}
