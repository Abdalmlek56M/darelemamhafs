export type Page = 'home' | 'live' | 'roster' | 'notifications' | 'supervisor' | 'subscriptions' | 'account'

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
  teacher: { id: string; name: string; hourlyRate: number | null }
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
  hourlyRate: number | null
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
  guardianPhone?: string | null
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

export type SupervisorTeacherNotesResponse = { count: number; notes: SupervisorTeacherNote[] }

export type SupervisionNote = {
  id: string
  text: string
  createdAt: string
  createdBy: string | null
}

export type SupervisorStudent = {
  id: string
  studentCode: string
  fullName: string
  phone: string | null
  guardianName: string | null
  guardianPhone: string | null
  status: string
  joinedOn: string
  circles: string[]
}

export type SupervisorStudentsResponse = { count: number; students: SupervisorStudent[] }

export type SupervisorStudentDetailResponse = {
  student: {
    id: string
    studentCode: string
    fullName: string
    phone: string | null
    guardianName: string | null
    guardianPhone: string | null
    status: string
    joinedOn: string
    notes: string | null
    circles: { id: string; name: string }[]
  }
  period: { from: string; to: string }
  attendance: { present: number; absent: number; excused: number; marked: number; rate: number | null }
  history: { date: string; circleName: string; startsAt: string; status: string; note: string | null }[]
  notes: SupervisionNote[]
  subscription: SupervisorSubscription[] | null
}

export type SupervisorScheduleEntry = { dayOfWeek: number; startsAt: string; durationMinutes: number }

export type SupervisorCircle = {
  id: string
  name: string
  teacherId: string | null
  teacherName: string | null
  isActive: boolean
  startsOn: string
  monthlyFee: number | null
  studentCount: number
  schedule: SupervisorScheduleEntry[]
}

export type SupervisorCirclesResponse = { count: number; circles: SupervisorCircle[] }

export type SupervisorCircleDetailResponse = {
  circle: {
    id: string
    name: string
    teacherId: string | null
    teacherName: string | null
    isActive: boolean
    startsOn: string
    monthlyFee: number | null
  }
  studentCount: number
  roster: {
    id: string
    studentCode: string
    fullName: string
    guardianName: string | null
    guardianPhone: string | null
    studentStatus: string
    enrollmentStatus: string
    enrolledOn: string
  }[]
  schedule: SupervisorScheduleEntry[]
  sessions: {
    date: string
    status: string
    startsAt: string
    durationMinutes: number
    note: string | null
    presentStudents: number
    missingStudents: number
  }[]
}

export type SupervisorTeacher = {
  id: string
  fullName: string
  phone: string | null
  status: string
  hourlyRate: number | null
  circleCount: number
  studentCount: number
  presentThisMonth: number
  missedThisMonth: number
}

export type SupervisorTeachersResponse = { count: number; month: string; teachers: SupervisorTeacher[] }

export type SupervisorTeacherDetailResponse = {
  teacher: { id: string; fullName: string; phone: string | null; status: string; hourlyRate: number | null }
  period: { from: string; to: string }
  attendance: {
    scheduled: number
    present: number
    absent: number
    cancelled: number
    rate: number | null
    hours: number
    overtimeMinutes: number
    undertimeMinutes: number
  }
  circles: { id: string; name: string; isActive: boolean; studentCount: number }[]
  history: {
    id: string
    date: string
    circleName: string
    startsAt: string
    status: string
    durationMinutes: number
    actualMinutes: number | null
    overtimeMinutes: number
    undertimeMinutes: number
    note: string | null
    payableAmount: number | null
    presentStudents: number
    absentStudents: number
  }[]
  notes: SupervisionNote[]
}

export type SupervisorTeacherAttendanceRow = {
  scheduleSlotId: string
  circleId: string
  circleName: string
  teacherId: string
  teacherName: string
  startsAt: string
  durationMinutes: number
  attendanceId: string | null
  status: string
  payableMinutes: number | null
  actualMinutes: number | null
  overtimeMinutes: number
  undertimeMinutes: number
  note: string | null
}

export type SupervisorStudentAttendanceRow = {
  attendanceId: string
  date: string
  studentId: string
  studentCode: string
  studentName: string
  circleId: string
  circleName: string
  startsAt: string
  status: string
  note: string | null
}

