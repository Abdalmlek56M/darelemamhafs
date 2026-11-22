const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

function parseMonthValue(value: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '')
  if (match) return { year: Number(match[1]), month: Math.min(12, Math.max(1, Number(match[2]))) }
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

function formatMonthValue(year: number, month: number): string {
  return year + '-' + String(month).padStart(2, '0')
}

type Props = { value: string; onChange: (value: string) => void; ariaLabel?: string; disabled?: boolean }

/**
 * Safari/iOS and several Android browsers do not support <input type="month">.
 * Two native selects (month name + year) always work, including RTL layouts.
 */
export default function MonthPicker({ value, onChange, ariaLabel = 'الشهر', disabled = false }: Props) {
  const { year, month } = parseMonthValue(value)
  const thisYear = new Date().getFullYear()
  const firstYear = Math.min(year, 2024)
  const lastYear = Math.max(year, thisYear + 2)
  const years: number[] = []
  for (let current = firstYear; current <= lastYear; current++) years.push(current)

  return <span className="month-picker-fields" role="group" aria-label={ariaLabel}>
    <select aria-label="الشهر" value={month} disabled={disabled} onChange={(event) => onChange(formatMonthValue(year, Number(event.target.value)))}>
      {monthNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
    </select>
    <select aria-label="السنة" value={year} disabled={disabled} onChange={(event) => onChange(formatMonthValue(Number(event.target.value), month))}>
      {years.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  </span>
}
