import { cairoDayKey } from '../lib/cairoDate'

export const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
export { formatTime12 } from '../lib/dates'

export function dateLabel(value: string | null | undefined) {
  if (!value) return '—'
  // Instants (createdAt/markedAt) are UTC: render their Cairo calendar date.
  if (value.includes('T')) {
    const dayKey = cairoDayKey(new Date(value))
    if (!dayKey) return '—'
    const [year, month, day] = dayKey.split('-')
    return `${day}/${month}/${year}`
  }
  const parts = value.slice(0, 10).split('-')
  if (parts.length !== 3) return value
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

export function statusLabel(status: string) {
  switch (status) {
    case 'present': return 'حاضرة'
    case 'absent': return 'غائبة'
    case 'excused': return 'بعذر'
    case 'cancelled': return 'ملغاة'
    case 'missing': return 'لم تسجل'
    case 'scheduled': return 'لم تبدأ'
    case 'in_progress': return 'جارية'
    case 'awaiting_attendance': return 'بانتظار الحضور'
    case 'completed': return 'مكتملة'
    case 'active': return 'نشطة'
    case 'paused': return 'موقوفة'
    case 'ended': return 'منتهية'
    case 'inactive': return 'غير نشطة'
    default: return status
  }
}

export function statusTone(status: string) {
  if (['present', 'active', 'completed'].includes(status)) return 't-badge t-badge-ok'
  if (['absent', 'missing', 'cancelled'].includes(status)) return 't-badge t-badge-bad'
  if (['excused', 'paused', 'awaiting_attendance'].includes(status)) return 't-badge t-badge-gold'
  if (['in_progress'].includes(status)) return 't-badge t-badge-live'
  return 't-badge t-badge-muted'
}

export function percent(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${value}%`
}

export { cairoToday as todayCairo } from '../lib/cairoDate'

export function whatsappHref(phone: string | null | undefined, message: string) {
  if (!phone) return null
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = `20${digits.slice(1)}`
  if (digits.length < 8) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

