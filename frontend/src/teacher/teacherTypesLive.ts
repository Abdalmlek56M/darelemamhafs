export type SupervisorSession = {
  sessionId: string
  circleName: string
  teacherName: string
  date: string
  scheduledStart: string
  scheduledMinutes: number
  startedAt: string
  endedAt: string | null
  status: string
  actualMinutes: number
  lateMinutes: number
  overtimeMinutes: number
  undertimeMinutes: number
  note: string | null
  studentCount: number
  attendanceId: string | null
  payableMinutes: number | null
  payableAmount: number | null
}

export type SupervisorAbsence = {
  attendanceId: string
  date: string
  studentId: string
  studentName: string
  studentCode: string
  guardianPhone?: string | null
  circleName: string
  teacherName: string
  status: 'absent' | 'excused'
  note: string | null
  markedAt: string
}

export type SupervisorUnpaid = {
  chargeId: string
  studentId: string
  billingMonth: string
  studentName: string
  studentCode: string
  guardianPhone: string | null
  joinedOn: string
  circleName: string
  teacherName: string
  amountDue: number | null
  paidAmount: number | null
  balance: number | null
  status: 'unpaid' | 'partial'
}

export type SupervisorLiveResponse = { now: string; date: string; sessions: SupervisorSession[] }

export type SupervisorTeacherAbsence = {
  teacherId: string
  teacherName: string
  phone: string | null
  circleId: string
  circleName: string
  scheduleSlotId: string
  startsAt: string
  durationMinutes: number
}

export type SupervisorAbsencesResponse = {
  date: string
  absences: SupervisorAbsence[]
  students: SupervisorAbsence[]
  teachers: SupervisorTeacherAbsence[]
  counts: { students: number; teachers: number }
}

export type SupervisorUnpaidResponse = { month: string; today: string; canViewAmounts: boolean; count: number; unpaid: SupervisorUnpaid[] }

export type SupervisorSubscription = {
  circleName: string
  status: 'paid' | 'partial' | 'unpaid'
  amountDue: number | null
  paidAmount: number | null
  balance: number | null
}

export type SupervisorTeacherNote = {
  id: string
  kind: 'session' | 'student'
  teacherId: string
  teacherName: string
  circleName: string
  date: string
  note: string
  markedAt: string
  studentName: string | null
  studentCode: string | null
}

export type SupervisorTeacherNotesResponse = { count: number; notes: SupervisorTeacherNote[]; banner: string | null }

