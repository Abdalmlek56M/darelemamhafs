import type { SessionStatus, TeacherAttendanceMark } from '../domain/types'

export type TeacherCalendarSession = {
  slotId: string
  circleId: string
  circleName: string
  startsAt: string
  durationMinutes: number
  studentCount: number
  sessionId: string | null
  sessionStatus: SessionStatus | null
  startedAt: string | null
  endedAt: string | null
  actualMinutes: number | null
  payableMinutes: number | null
  payBasis: string | null
  note: string | null
  attendanceId: string | null
}

export type TeacherCalendarDay = {
  date: string
  dayOfWeek: number
  sessions: TeacherCalendarSession[]
}

export type TeacherCalendarResponse = {
  from: string
  to: string
  days: TeacherCalendarDay[]
}

export type TeacherHistorySession = {
  id: string
  date: string
  circleName: string
  status: SessionStatus
  startedAt: string
  endedAt: string | null
  scheduledMinutes: number
  actualMinutes: number | null
  payableMinutes: number | null
  payBasis: string | null
  overtimeMinutes: number
  undertimeMinutes: number
  note: string | null
  presentStudents: number
  totalStudents: number
}

export type TeacherHistoryAttendance = {
  id: string
  date: string
  circleName: string
  status: TeacherAttendanceMark
  durationMinutes: number
  payableAmount: number | null
  note: string | null
  markedAt: string
}

export type TeacherHistoryLogin = {
  createdAt: string
  lastSeenAt: string | null
  ip: string | null
  userAgent: string | null
}

export type TeacherHistoryResponse = {
  sessions: TeacherHistorySession[]
  attendance: TeacherHistoryAttendance[]
  logins: TeacherHistoryLogin[]
  sessionTotal?: number
  attendanceTotal?: number
}
