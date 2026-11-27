import type { NotificationSeverity, SessionStatus } from '../domain/types'

export type Page = 'home' | 'live' | 'roster' | 'notifications' | 'supervisor' | 'subscriptions' | 'account' | 'requests' | 'calendar' | 'history'

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
  canStart: boolean
  isCurrent: boolean
  isNext: boolean
  minutesUntilStart: number | null
  lateMinutes: number
  sessionId: string | null
  sessionStatus: SessionStatus | null
  startedAt: string | null
  endedAt: string | null
  actualDurationMinutes: number | null
  payableDurationMinutes: number | null
  payBasis: string | null
  overtimeMinutes: number
  undertimeMinutes: number
  note: string | null
  attendanceId: string | null
}

export type TodayResponse = {
  teacher: { id: string; name: string; hourlyRate: number | null }
  date: string
  dayOfWeek: number
  currentSlotId: string | null
  nextSlotId: string | null
  slots: Slot[]
}

export type StartResponse = {
  sessionId: string
  status: SessionStatus
  resumed: boolean
  scheduledDurationMinutes: number
  circleName: string
  startsAt: string
  hourlyRate: number | null
}

export type EndResponse = {
  sessionId: string
  status: SessionStatus
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
  guardianPhone?: string | null
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
  severity: NotificationSeverity
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

