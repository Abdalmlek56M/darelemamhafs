export function localDateString() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` }
export function currentMonth() { return localDateString().slice(0, 7) }
export function timeLabel(value: string) { return value?.slice(0, 5) || '—' }
export function formatTime12(value: string | null | undefined) {
  const raw = (value ?? '').slice(0, 5)
  if (!/^\d{2}:\d{2}$/.test(raw)) return raw || '—'
  const [hourValue, minuteValue] = raw.split(':').map(Number)
  const suffix = hourValue < 12 ? 'ص' : 'م'
  const hour = hourValue % 12 === 0 ? 12 : hourValue % 12
  return `${hour}:${String(minuteValue).padStart(2, '0')} ${suffix}`
}
export function remainingLabel(ms: number) { if (ms <= 0) return 'بدأ موعد الحلقة'; const minutesTotal = Math.ceil(ms / 60_000); const days = Math.floor(minutesTotal / 1440); const hours = Math.floor((minutesTotal % 1440) / 60); const minutes = minutesTotal % 60; return [days ? `${days} يوم` : '', hours ? `${hours} ساعة` : '', minutes || (!days && !hours) ? `${minutes} دقيقة` : ''].filter(Boolean).join(' و') }
export function sessionDateTime(date: string, time: string) { return new Date(`${date.slice(0,10)}T${timeLabel(time)}:00`) }
export function localDateKey(value: Date) { return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}` }
