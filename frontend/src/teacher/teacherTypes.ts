export type Page = 'home' | 'live' | 'roster' | 'notifications' | 'supervisor' | 'subscriptions'

export type TeacherSession = {
  id: string
  username: string
  displayName: string
  email: string | null
  permissionCodes: string[]
  teacherId: string | null
}

export type Slot = {
  id: string
  circleId: string
  circleName: string
  startsAt: string
  endsAt: string
  durationMinutes: number
  studentCount: number
  isCurrent: boolean
  isNext: boolean
  minutesUntilStart: number | null
  lateMinutes: number
  sessionId: string | null
  sessionStatus: string | null
  startedAt: string | null
  endedAt: string | null
  actualDurationMinutes: number | null
  payableDurationMinutes: number | null
  payBasis: string | null
  overtimeMinutes: number
  undertimeMinutes: number
  note: string | null
}

export type TodayResponse = {
  teacher: { id: string; name: string; hourlyRate: number }
  date: string
  dayOfWeek: number
  currentSlotId: string | null
  nextSlotId: string | null
  slots: Slot[]
}

export type StartResponse = {
  sessionId: string
  status: string
  resumed: boolean
  scheduledDurationMinutes: number
  circleName: string
  startsAt: string
  hourlyRate: number
}

export type EndResponse = {
  sessionId: string
  status: string
  alreadyEnded: boolean
  actualDurationMinutes: number
  payableDurationMinutes: number
  overtimeMinutes: number
  undertimeMinutes: number
  payBasis: string | null
  payableAmount: number | null
  note: string | null
  message: string
}

export type RosterStudent = {
  enrollmentId: string
  studentId: string
  studentCode: string
  studentName: string
  status: 'present' | 'excused' | 'absent' | null
  note: string | null
  eligibleForDate: boolean
  eligibilityReason: string | null
  enrollmentStatus: string
}

export type RosterResponse = {
  sessionId: string
  date: string
  slotId: string
  students: RosterStudent[]
}

export type AttendanceMark = {
  enrollmentId: string
  status: 'present' | 'excused' | 'absent'
  note?: string
}

export type EarningsResponse = {
  month: string
  totals: { sessions: number; minutes: number; payable: number }
  sessions: {
    attendanceId: string
    date: string
    circleName: string
    payableMinutes: number
    actualMinutes: number | null
    hourlyRate: number
    payableAmount: number
    payBasis: string | null
    overtimeMinutes: number
    undertimeMinutes: number
    note: string | null
    sessionId: string | null
    sessionStatus: string | null
  }[]
}

export type SubscriptionStudent = {
  studentName: string
  studentCode: string
  circleName: string
  startsOn: string
  joinedOn: string
  amountDue: number | null
  paidAmount: number
  balance: number | null
  status: 'paid' | 'partial' | 'unpaid' | 'not-set'
}

export type SubscriptionsResponse = {
  month: string
  students: SubscriptionStudent[]
}

export type AppNotification = {
  id: string
  category: string
  status: 'open' | 'resolved'
  severity: string
  title: string
  body: string
  actionUrl: string | null
  createdAt: string
  resolvedAt: string | null
  resolutionNote: string | null
  readAt: string | null
}

export type NotificationsResponse = {
  counts: { open: number; unread: number }
  notifications: AppNotification[]
}

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
  studentName: string
  studentCode: string
  circleName: string
  teacherName: string
  status: 'absent' | 'excused'
  note: string | null
  markedAt: string
}

export type SupervisorUnpaid = {
  chargeId: string
  billingMonth: string
  studentName: string
  studentCode: string
  joinedOn: string
  circleName: string
  teacherName: string
  amountDue: number
  paidAmount: number
  balance: number
  status: string
}

export type SupervisorLiveResponse = { now: string; date: string; sessions: SupervisorSession[] }
export type SupervisorAbsencesResponse = { date: string; absences: SupervisorAbsence[] }
export type SupervisorUnpaidResponse = { month: string; today: string; count: number; unpaid: SupervisorUnpaid[] }
