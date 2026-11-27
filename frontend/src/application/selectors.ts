import type {
  Student,
  Teacher,
  Circle,
  CollectionRow,
  ScheduleSlot,
  AttendanceRow,
  AdExpense,
  OperatingExpense,
  StudentStatus,
  TeacherStatus,
} from '../domain/types'
import { timeLabel } from '../lib/dates'
import { addCairoDays, cairoDayKey, cairoInstant, dayKeyWeekday } from '../lib/cairoDate'

export type MonthSession = {
  slot: ScheduleSlot
  date: string
  target: Date
  attendance?: AttendanceRow
}

export function getNextSessions(scheduleSlots: ScheduleSlot[], circles: Circle[], clockNow: number) {
  const todayKey = cairoDayKey(new Date(clockNow))
  return scheduleSlots
    .filter(slot => slot.isActive && slot.circleIsActive !== false)
    .map(slot => {
      const startTime = timeLabel(slot.startsAt)
      const circleStart = circles.find(circle => circle.id === slot.circleId)?.startsOn?.slice(0, 10)
      // Start from the later of today and the circle's declared start date.
      // This avoids skipping or miscalculating weekdays when the start date is in the future.
      const baselineKey = circleStart && circleStart > todayKey ? circleStart : todayKey
      const firstKey = addCairoDays(baselineKey, (slot.dayOfWeek - dayKeyWeekday(baselineKey) + 7) % 7)
      let target = cairoInstant(firstKey, startTime)
      let endsAt = new Date(target.getTime() + slot.durationMinutes * 60_000)
      const isRunning = cairoDayKey(target) === todayKey && target.getTime() <= clockNow && clockNow < endsAt.getTime()
      if (target.getTime() <= clockNow && !isRunning) {
        target = cairoInstant(addCairoDays(firstKey, 7), startTime)
        endsAt = new Date(target.getTime() + slot.durationMinutes * 60_000)
      }
      return { ...slot, target, endsAt, isRunning }
    })
    .sort((a, b) => a.target.getTime() - b.target.getTime())
}

export function getMonthSessions(
  scheduleSlots: ScheduleSlot[],
  attendanceRows: AttendanceRow[],
  currentMonthValue: string,
): MonthSession[] {
  const [year, month] = currentMonthValue.split('-').map(Number)
  if (!year || !month) return []
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const indexed = new Map<string, MonthSession>()
  const slotById = new Map<string, ScheduleSlot>(scheduleSlots.map(slot => [slot.id, slot] as const))
  const attendanceIndex = new Map<string, AttendanceRow>(
    attendanceRows
      .filter(a => a.scheduleSlotId)
      .map(a => [`${a.scheduleSlotId}|${a.sessionDate.slice(0, 10)}`, a] as [string, AttendanceRow]),
  )

  // Active slots create the expected weekly occurrences for the selected month.
  for (let day = 1; day <= count; day++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const weekday = dayKeyWeekday(date)
    for (const slot of scheduleSlots) {
      if (!slot.isActive || slot.dayOfWeek !== weekday) continue
      // Include recurring dates before startsOn as clearly marked historical candidates.
      // Administrators may need to enter backdated attendance; the UI labels these rows.
      const key = `${slot.id}|${date}`
      indexed.set(key, { slot, date, target: cairoInstant(date, slot.startsAt), attendance: attendanceIndex.get(key) })
    }
  }

  // An inactive slot appears only on dates that already have saved teacher attendance.
  for (const attendance of attendanceRows) {
    if (!attendance.scheduleSlotId || !attendance.sessionDate.startsWith(`${currentMonthValue}-`)) continue
    const slot = slotById.get(attendance.scheduleSlotId)
    if (!slot) continue
    const date = attendance.sessionDate.slice(0, 10)
    const key = `${slot.id}|${date}`
    const existing = indexed.get(key)
    if (existing) existing.attendance = attendance
    else indexed.set(key, { slot, date, target: cairoInstant(date, attendance.startsAt || slot.startsAt), attendance })
  }

  return [...indexed.values()].sort((a, b) => b.target.getTime() - a.target.getTime())
}

export function getMonthlyTeacherPay(attendanceRows: AttendanceRow[]) {
  const acc = new Map<string, { teacherId: string; teacherName: string; present: number; hours: number; payable: number }>()
  for (const row of attendanceRows) {
    if (row.status !== 'present') continue
    const item = acc.get(row.teacherId) ?? {
      teacherId: row.teacherId,
      teacherName: row.teacherName,
      present: 0,
      hours: 0,
      payable: 0,
    }
    item.present++
    item.hours += row.durationMinutes / 60
    item.payable += row.payableAmount ?? 0
    acc.set(row.teacherId, item)
  }
  return Array.from(acc.values()).sort((a, b) => a.teacherName.localeCompare(b.teacherName, 'ar'))
}

/** Monthly charge suggestion is the fee agreed on the enrollment, never a mid-month proration. */
export function getSuggestedMonthlyCharge(row: Pick<CollectionRow, 'agreedMonthlyFee'>) {
  return row.agreedMonthlyFee
}

export function getFilteredStudents(students: Student[], query: string, statusFilter: 'all' | StudentStatus) {
  return students.filter(student => {
    const term = query.trim().toLocaleLowerCase('ar')
    const matches = !term || [
      student.fullName,
      student.studentCode,
      student.phone ?? '',
      student.guardianName ?? '',
      student.guardianPhone ?? '',
      student.circleNames,
    ].some(x => x.toLocaleLowerCase('ar').includes(term))
    return matches && (statusFilter === 'all' || student.status === statusFilter)
  })
}

export function getFilteredTeachers(teachers: Teacher[], query: string, teacherFilter: 'all' | TeacherStatus) {
  return teachers.filter(t => {
    const term = query.trim().toLocaleLowerCase('ar')
    return (!term || [t.fullName, t.teacherCode, t.phone ?? '', t.circleNames]
      .some(x => x.toLocaleLowerCase('ar').includes(term))) &&
      (teacherFilter === 'all' || t.status === teacherFilter)
  })
}

/**
 * Resolve one of a teacher's circle names to its circle record. Teacher DTOs only
 * expose circle names, so scope by the teacher id and refuse ambiguous matches
 * instead of opening an arbitrary circle that happens to share the name.
 */
export function findTeacherCircleByName(circles: Circle[], teacherId: string, name: string): Circle | undefined {
  const matches = circles.filter(circle => circle.name === name)
  return matches.find(circle => circle.teacherId === teacherId) ?? (matches.length === 1 ? matches[0] : undefined)
}

export function getCurrentMonthTotals(collections: CollectionRow[]) {
  return collections.reduce(
    (acc, row) => ({
      due: acc.due + row.amountDue,
      paid: acc.paid + row.paidAmount,
      balance: acc.balance + row.balance,
    }),
    { due: 0, paid: 0, balance: 0 },
  )
}

export function getMonthlyTeacherPayTotal(attendanceRows: AttendanceRow[]) {
  return attendanceRows
    .filter(row => row.status === 'present')
    .reduce((sum, row) => sum + (row.payableAmount ?? 0), 0)
}

export function getMonthlyAdvertisingTotal(advertisingExpenses: AdExpense[]) {
  return advertisingExpenses.reduce((sum, row) => sum + row.monthAmount, 0)
}

export function getMonthlyOperatingExpenseTotal(operatingExpenses: OperatingExpense[]) {
  return operatingExpenses.reduce((sum, row) => sum + row.amount, 0)
}
