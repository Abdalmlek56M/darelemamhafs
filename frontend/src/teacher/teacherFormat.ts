export function money(value: number | null | undefined) {
  return `${(value ?? 0).toFixed(2)} ج.م`
}

export function minutesLabel(totalMinutes: number) {
  const minutes = Math.max(0, Math.floor(totalMinutes))
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}:${String(minutes % 60).padStart(2, '0')}` : `${minutes} د`
}

export function elapsedMinutes(startedAt: string | null | undefined) {
  if (!startedAt) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000))
}

export function localTime(value: string) {
  return new Date(value).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
}

export function localDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function timeRange(start: string, end: string) {
  return `${start} – ${end}`
}
