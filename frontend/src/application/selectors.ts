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
  TeacherPaySummary,
  CircleProfitSummary,
} from '../domain/types'
import { localDateKey, timeLabel, sessionDateTime } from '../lib/dates'

export type MonthSession = {
  slot: ScheduleSlot
  date: string
  target: Date
  attendance?: AttendanceRow
}

export function getNextSessions(scheduleSlots: ScheduleSlot[], circles: Circle[], clockNow: number) {
  const todayKey = localDateKey(new Date(clockNow))
  return scheduleSlots
    .filter(slot => slot.isActive)
    .map(slot => {
      const [hour, minute] = timeLabel(slot.startsAt).split(':').map(Number)
      const circleStart = circles.find(circle => circle.id === slot.circleId)?.startsOn
      // Start from the later of today and the circle's declared start date.
      // This avoids skipping or miscalculating weekdays when the start date is in the future.
      const baselineKey = circleStart && circleStart > todayKey ? circleStart : todayKey
      const target = new Date(`${baselineKey}T12:00:00`)
      const offset = (slot.dayOfWeek - target.getDay() + 7) % 7
      target.setDate(target.getDate() + offset)
      target.setHours(hour, minute, 0, 0)
      let endsAt = new Date(target.getTime() + slot.durationMinutes * 60_000)
      const isRunning = localDateKey(target) === todayKey && target.getTime() <= clockNow && clockNow < endsAt.getTime()
      if (target.getTime() <= clockNow && !isRunning) {
        target.setDate(target.getDate() + 7)
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
  const count = new Date(year, month, 0).getDate()
  const indexed = new Map<string, MonthSession>()
  const slotById = new Map<string, ScheduleSlot>(scheduleSlots.map(slot => [slot.id, slot] as const))
  const attendanceIndex = new Map<string, AttendanceRow>(
    attendanceRows
      .filter(a => a.scheduleSlotId)
      .map(a => [`${a.scheduleSlotId}|${a.sessionDate.slice(0, 10)}`, a] as [string, AttendanceRow]),
  )

  // Active slots create the expected weekly occurrences for the selected month.
  for (let day = 1; day <= count; day++) {
    const dateObj = new Date(year, month - 1, day)
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    for (const slot of scheduleSlots) {
      if (!slot.isActive || slot.dayOfWeek !== dateObj.getDay()) continue
      // Include recurring dates before startsOn as clearly marked historical candidates.
      // Administrators may need to enter backdated attendance; the UI labels these rows.
      const key = `${slot.id}|${date}`
      indexed.set(key, { slot, date, target: sessionDateTime(date, slot.startsAt), attendance: attendanceIndex.get(key) })
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
    else indexed.set(key, { slot, date, target: sessionDateTime(date, attendance.startsAt || slot.startsAt), attendance })
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

export function getSuggestedFirstMonthCharge(row: CollectionRow, monthValue: string) {
  const [year, month] = monthValue.split('-').map(Number)
  if (!year || !month) return row.agreedMonthlyFee
  const monthStart = new Date(year, month - 1, 1, 12)
  const monthEnd = new Date(year, month, 0, 12)
  const toLocalDate = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  const start = [row.circleStartsOn, row.enrollmentStartsOn, toLocalDate(monthStart)].sort().at(-1)!
  const end = row.enrollmentEndsOn && row.enrollmentEndsOn < toLocalDate(monthEnd)
    ? row.enrollmentEndsOn
    : toLocalDate(monthEnd)
  if (start > end || start > toLocalDate(monthEnd)) return 0
  const startDay = Number(start.slice(8, 10))
  const endDay = Number(end.slice(8, 10))
  const daysInMonth = monthEnd.getDate()
  const activeDays = Math.max(0, endDay - startDay + 1)
  return Math.round(row.agreedMonthlyFee * activeDays / daysInMonth * 100) / 100
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

export function getDashboardProfit(args: {
  currentMonthTotals: { due: number; paid: number; balance: number }
  monthlyAdvertisingTotal: number
  monthlyTeacherPayTotal: number
  monthlyOperatingExpenseTotal: number
  collections: CollectionRow[]
  monthSessions: MonthSession[]
  clockNow: number
}) {
  const {
    currentMonthTotals,
    monthlyAdvertisingTotal,
    monthlyTeacherPayTotal,
    monthlyOperatingExpenseTotal,
    collections,
    monthSessions,
    clockNow,
  } = args

  return {
    billed: currentMonthTotals.due,
    collected: currentMonthTotals.paid,
    balance: currentMonthTotals.balance,
    advertising: monthlyAdvertisingTotal,
    teacherPay: monthlyTeacherPayTotal,
    otherExpenses: monthlyOperatingExpenseTotal,
    net: currentMonthTotals.due - monthlyAdvertisingTotal - monthlyTeacherPayTotal - monthlyOperatingExpenseTotal,
    withoutChargeCount: collections.filter(row => !row.chargeId).length,
    unmarkedPastSessions: monthSessions.filter(item => item.target.getTime() <= clockNow && !item.attendance).length,
  }
}

export function getTeacherPaySummary(attendanceRows: AttendanceRow[]): TeacherPaySummary[] {
  const byId = new Map<string, TeacherPaySummary>()
  for (const row of attendanceRows) {
    if (row.status !== 'present') continue
    let item = byId.get(row.teacherId)
    if (!item) {
      item = {
        teacherId: row.teacherId,
        teacherName: row.teacherName,
        sessions: 0,
        hours: 0,
        payable: 0,
        avgHourlyRate: 0,
      }
      byId.set(row.teacherId, item)
    }
    item.sessions += 1
    item.hours += row.durationMinutes / 60
    item.payable += row.payableAmount ?? 0
  }
  const rows = Array.from(byId.values())
  for (const row of rows) row.avgHourlyRate = row.hours > 0 ? row.payable / row.hours : 0
  return rows.sort((a, b) => b.payable - a.payable || a.teacherName.localeCompare(b.teacherName, 'ar'))
}

export function getCircleProfitSummary(args: {
  circles: Circle[]
  collections: CollectionRow[]
  advertisingExpenses: AdExpense[]
  attendanceRows: AttendanceRow[]
  operatingExpenses: OperatingExpense[]
}): CircleProfitSummary[] {
  const { circles, collections, advertisingExpenses, attendanceRows, operatingExpenses } = args
  const byId = new Map<string, CircleProfitSummary>()
  const ensure = (circleId: string, circleName: string) => {
    let row = byId.get(circleId)
    if (!row) {
      row = { circleId, circleName, billed: 0, collected: 0, advertising: 0, teacherPay: 0, linkedExpenses: 0, uncharged: 0, net: 0 }
      byId.set(circleId, row)
    }
    return row
  }

  for (const circle of circles) if (circle.isActive) ensure(circle.id, circle.name)
  for (const row of collections) {
    const target = ensure(row.circleId, row.circleName)
    target.billed += row.amountDue
    target.collected += row.paidAmount
    if (!row.chargeId) target.uncharged++
  }
  for (const row of advertisingExpenses) ensure(row.circleId, row.circleName).advertising += row.monthAmount
  for (const row of attendanceRows) {
    if (row.status === 'present') ensure(row.circleId, row.circleName).teacherPay += row.payableAmount ?? 0
  }
  for (const row of operatingExpenses) {
    if (row.circleId) ensure(row.circleId, row.circleName || 'حلقة غير معروفة').linkedExpenses += row.amount
  }

  const rows = Array.from(byId.values())
  for (const row of rows) row.net = row.billed - row.advertising - row.teacherPay - row.linkedExpenses
  return rows.sort((a, b) => b.net - a.net || a.circleName.localeCompare(b.circleName, 'ar'))
}
