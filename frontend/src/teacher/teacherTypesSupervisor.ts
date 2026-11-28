import type { SupervisorSubscription } from './teacherTypesLive'
import type { EnrollmentStatus, StudentAttendanceMark, StudentStatus, TeacherAttendanceMark, TeacherStatus } from '../domain/types'

export type AttendanceRequest = {
  id: string
  type: 'absence' | 'cancellation' | 'correction'
  circleName: string
  date: string | null
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  createdAt: string
  reviewNote: string | null
  reviewedAt: string | null
  payload: string | null
}

export type SupervisorAttendanceRequest = AttendanceRequest & {
  teacherName: string
  teacherId: string
  circleId: string
  attendanceId: string | null
}

export type CreateAttendanceRequest = {
  type: 'absence' | 'cancellation' | 'correction'
  scheduleSlotId?: string
  date?: string
  attendanceId?: string
  reason: string
  proposedDurationMinutes?: number
  proposedNote?: string
}

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
  status: StudentStatus
  joinedOn: string
  subscriptionStatus: 'paid' | 'partial' | 'unpaid' | 'not-set'
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
    status: StudentStatus
    joinedOn: string
    notes: string | null
    circles: { id: string; name: string }[]
  }
  period: { from: string; to: string }
  attendance: { present: number; absent: number; excused: number; marked: number; rate: number | null }
  history: { date: string; circleName: string; startsAt: string; status: StudentAttendanceMark; note: string | null }[]
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
  circleType?: 'individual' | 'group'
  isChildren?: boolean
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
    studentStatus: StudentStatus
    enrollmentStatus: EnrollmentStatus
    enrolledOn: string
  }[]
  schedule: SupervisorScheduleEntry[]
  sessions: {
    date: string
    status: TeacherAttendanceMark
    startsAt: string
    durationMinutes: number
    note: string | null
    presentStudents: number
    missingStudents: number
    studentAttendance: { studentName: string; studentCode: string; status: StudentAttendanceMark; note: string | null }[]
  }[]
}

export type SupervisorTeacher = {
  id: string
  fullName: string
  phone: string | null
  status: TeacherStatus
  hourlyRate: number | null
  circleCount: number
  studentCount: number
  presentThisMonth: number
  missedThisMonth: number
}

export type SupervisorTeachersResponse = { count: number; month: string; teachers: SupervisorTeacher[] }

export type SupervisorTeacherDetailResponse = {
  teacher: { id: string; fullName: string; phone: string | null; status: TeacherStatus; hourlyRate: number | null }
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
    status: TeacherAttendanceMark
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
  status: TeacherAttendanceMark
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
  status: StudentAttendanceMark
  note: string | null
}

