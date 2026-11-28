// Shared domain contracts used by pages and services.
export type Theme = 'dark' | 'light'
export type Branding = { brandName: string; logoDataUrl: string | null; facebookUrl: string | null; tiktokUrl: string | null; whatsappUrl: string | null }
export type Page = 'dashboard' | 'notifications' | 'requests' | 'members' | 'students' | 'teachers' | 'teacher-notes' | 'circles' | 'schedule' | 'payments' | 'meet' | 'users' | 'system'
export type Gate = 'checking' | 'setup' | 'login' | 'ready'
export type StudentStatus = 'active' | 'paused' | 'withdrawn' | 'archived'
export type TeacherStatus = 'active' | 'inactive' | 'archived'
export type Gender = 'male' | 'female'
export type CircleType = 'individual' | 'group'
/** Severity shown by the admin/teacher notification centers. */
export type NotificationSeverity = 'info' | 'warning' | 'critical'
/** Saved teacher-attendance state (supervisor attendance rows use "missing"/"scheduled" for unmarked past/future slots). */
export type TeacherAttendanceMark = 'present' | 'absent' | 'cancelled' | 'missing' | 'scheduled'
/** Saved student-attendance state. */
export type StudentAttendanceMark = 'present' | 'absent' | 'excused'
/** Lifecycle of a teaching session. */
export type SessionStatus = 'scheduled' | 'in_progress' | 'awaiting_attendance' | 'completed' | 'cancelled'
/** Enrollment lifecycle for a student inside one circle. */
export type EnrollmentStatus = 'active' | 'paused' | 'ended'
export type Session = { id: string; username: string; displayName: string; permissionCodes: string[]; teacherId?: string | null }
export type Student = {
  id: string; studentCode: string; fullName: string; ageYears: number | null; phone: string | null
  guardianName: string | null; guardianPhone: string | null; joinedOn: string; status: StudentStatus
  notes: string | null; createdAt: string; updatedAt: string; circleNames: string
  currentMonthDue: number | null; currentMonthPaid: number | null; currentMonthPaymentStatus: 'not-set' | 'unpaid' | 'partial' | 'paid' | null
  gender?: Gender | null; guardianGender?: Gender | null
}
export type Teacher = { id: string; teacherCode: string; fullName: string; phone: string | null; hourlyRate: number | null; status: TeacherStatus; notes: string | null; circleNames: string; circleCount: number; gender?: Gender | null }
export type TeacherHistoryCircle = { id: string; circleCode: string; name: string; monthlyFee: number | null; isActive: boolean; activeStudentCount: number }
export type TeacherHistoryScheduleSlot = { id: string; circleId: string; circleName: string; dayOfWeek: number; startsAt: string; durationMinutes: number; isActive: boolean }
export type TeacherHistoryAttendance = { id: string; scheduleSlotId: string | null; sessionDate: string; circleName: string; startsAt: string; durationMinutes: number; status: 'present' | 'absent' | 'cancelled'; hourlyRateSnapshot: number | null; payableAmount: number | null; note: string | null; markedAt: string; presentStudentsCount: number }
export type TeacherHistoryData = { teacher: Teacher; circles: TeacherHistoryCircle[]; scheduleSlots: TeacherHistoryScheduleSlot[]; attendance: TeacherHistoryAttendance[]; notes: { id: string; noteText: string; createdAt: string; createdBy: string }[]; attendanceVisible: boolean; circlesVisible: boolean; financeVisible: boolean; attendanceLimit: number; totals: { presentSessions: number; totalHours: number; payableTotal: number | null } | null }
export type Circle = { id: string; circleCode: string; name: string; teacherId: string | null; teacherName: string; monthlyFee: number | null; scheduleText: string | null; isActive: boolean; activeStudentCount: number; startsOn: string; circleType?: CircleType; isChildren?: boolean }
export type CollectionRow = { enrollmentId: string; chargeId: string | null; studentId: string; studentCode: string; studentName: string; circleId: string; circleName: string; teacherName: string; agreedMonthlyFee: number; amountDue: number; paidAmount: number; balance: number; note: string | null; paymentStatus: 'not-set' | 'unpaid' | 'partial' | 'paid'; billingMonth: string; enrollmentStartsOn: string; enrollmentEndsOn: string | null; circleStartsOn: string }
export type Permission = { code: string; nameAr: string }
export type AdminUser = { id: string; username: string; displayName: string; isActive: boolean; isLocked: boolean; teacherId: string | null; lockReason: string | null; permissionCodes: string[]; scopeCircleIds: string[]; scopeTeacherIds: string[]; createdAt: string; gender?: Gender | null }
export type SavedReport = { id: string; title: string; billingMonth: string; createdAt: string }
export type HistoryPayment = { id: string; amount: number; paidAt: string; method: string | null; reference: string | null; note: string | null; hasReceipt?: boolean; voidedAt?: string | null; voidReason?: string | null; voidBlockedReason?: string | null }
export type HistoryCharge = { id: string; billingMonth: string; amountDue: number; paidAmount: number; balance: number; note: string | null; circleName: string; payments: HistoryPayment[]; voidedAt?: string | null; voidReason?: string | null }
export type HistoryStudentAttendance = { id: string; sessionDate: string; circleName: string; startsAt: string; status: 'present' | 'absent' | 'excused'; teacherName: string; note: string | null; markedAt: string }
export type HistoryData = {
  student: Student; financeVisible?: boolean; attendanceVisible?: boolean; attendance?: HistoryStudentAttendance[]; enrollments: { id: string; circleId: string; circleName: string; teacherName: string; startsOn: string; endsOn: string | null; agreedMonthlyFee: number | null; status: string }[]
  charges: HistoryCharge[]; notes: { id: string; noteText: string; createdAt: string; createdBy: string }[]
}
export type CircleStudent = { enrollmentId: string; studentId: string; studentCode: string; studentName: string; ageYears: number | null; startsOn: string; endsOn: string | null; enrollmentStatus: string; agreedMonthlyFee: number | null; currentMonthDue: number | null; currentMonthPaid: number | null; chargeId: string | null }
export type VoidTargetKind = 'charge' | 'payment'
/** Record selected for a Void/Reverse action — the record is kept, never deleted (ADR-0005). */
export type VoidTarget = { kind: VoidTargetKind; id: string; label: string; studentId?: string }
export type Notice = { tone: 'success' | 'error' | 'info'; text: string }
export type StudentForm = { studentCode: string; fullName: string; ageYears: string; phone: string; guardianName: string; guardianPhone: string; joinedOn: string; status: StudentStatus; notes: string; gender: '' | Gender; guardianGender: '' | Gender }
export type TeacherForm = { teacherCode: string; fullName: string; phone: string; hourlyRate: string; status: TeacherStatus; notes: string; gender: '' | Gender }
export type CircleForm = { circleCode: string; name: string; teacherId: string; monthlyFee: string; scheduleText: string; isActive: boolean; startsOn: string; circleType: CircleType; isChildren: boolean }
export type CircleScheduleDraft = { dayOfWeek: string; startsAt: string; durationMinutes: string }
export type EnrollmentForm = { studentId: string; circleId: string; startsOn: string; agreedMonthlyFee: string; allowClosedCircle: boolean }
export type ChargeForm = { enrollmentId: string; billingMonth: string; amountDue: string; note: string }
export type PaymentForm = { monthlyChargeId: string; amount: string; method: string; reference: string; note: string }
export type UserForm = { id?: string; username: string; displayName: string; password: string; isActive: boolean; permissionCodes: string[]; teacherId?: string | null; isLocked?: boolean; lockReason?: string; scopeCircleIds: string[]; scopeTeacherIds: string[]; gender?: '' | Gender }
export type ReportSnapshot = { id: string; title: string; billingMonth: string; createdAt: string; snapshot: { schoolName: string; billingMonth: string; generatedAt: string; rows: CollectionRow[]; totalDue: number; totalPaid: number; totalBalance: number; rowCount: number } }
export type ScheduleSlot = { id: string; circleId: string; circleName: string; teacherId: string | null; teacherName: string; dayOfWeek: number; startsAt: string; durationMinutes: number; isActive: boolean; circleIsActive?: boolean }
export type AttendanceRow = { id: string; scheduleSlotId: string | null; circleId: string; circleName: string; teacherId: string; teacherName: string; sessionDate: string; startsAt: string; durationMinutes: number; status: 'present' | 'absent' | 'cancelled'; hourlyRateSnapshot: number | null; payableAmount: number | null; note: string | null; markedAt: string }
export type StudentAttendanceSummary = { scheduleSlotId: string; sessionDate: string; totalStudents: number; presentStudents: number }
export type StudentAttendanceRow = { id: string; scheduleSlotId: string; enrollmentId: string; studentId: string; studentCode: string; studentName: string; circleId: string; circleName: string; teacherId: string | null; teacherName: string; sessionDate: string; startsAt: string; status: 'present' | 'absent' | 'excused'; note: string | null; markedAt: string }
export type StudentAttendanceRosterRow = { enrollmentId: string; studentId: string; studentCode: string; studentName: string; status: 'present' | 'absent' | 'excused' | null; note: string | null; eligibleForDate: boolean; eligibilityReason: 'paused' | 'before-circle-start' | 'before-enrollment-start' | 'after-enrollment-end' | 'not-active-on-date' | null; startsOn: string; endsOn: string | null; enrollmentStatus: 'active' | 'ended' | 'paused' }
export type AdExpense = { id: string; circleId: string; circleName: string; platform: string | null; startDate: string; daysCount: number; dailyCost: number; totalAmount: number; overlapDays: number; monthAmount: number; note: string | null; createdAt: string }
export type AdExpenseForm = { circleId: string; platform: string; startDate: string; daysCount: string; dailyCost: string; note: string }
export type OperatingExpense = { id: string; expenseDate: string; category: string; description: string; amount: number; circleId: string | null; circleName: string | null; note: string | null; createdAt: string }
export type OperatingExpenseForm = { expenseDate: string; category: string; description: string; amount: string; circleId: string; note: string }
export type CircleProfitSummary = { circleId: string; circleName: string; billed: number; collected: number; advertising: number; teacherPay: number; linkedExpenses: number; uncharged: number; net: number }
export type TeacherPaySummary = { teacherId: string; teacherName: string; sessions: number; hours: number; payable: number; avgHourlyRate: number }
export type SetupCredentials = { username: string; displayName: string; password: string; confirmPassword: string }
export type LoginCredentials = { username: string; password: string; rememberMe: boolean; turnstileToken?: string }
