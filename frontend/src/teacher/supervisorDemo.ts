import { todayCairo } from './supervisorFormat'
import type {
  SupervisorAbsencesResponse, SupervisorAttendanceRequest, SupervisorCircle, SupervisorCircleDetailResponse,
  SupervisorLiveResponse, SupervisorStudent, SupervisorStudentAttendanceRow, SupervisorStudentDetailResponse,
  SupervisorTeacher, SupervisorTeacherAttendanceRow, SupervisorTeacherDetailResponse, SupervisorTeacherNote, SupervisorUnpaidResponse,
} from './teacherTypes'

const today = todayCairo()
const day = (offset: number) => {
  const value = new Date(`${today}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + offset)
  return value.toISOString().slice(0, 10)
}

export const demoStudents: SupervisorStudent[] = [
  { id: 'demo-s1', studentCode: 'ST-1001', fullName: 'مريم أحمد', phone: '01012345678', guardianName: 'أحمد سعيد', guardianPhone: '01098765432', status: 'active', joinedOn: day(-120), subscriptionStatus: 'paid', circles: ['حلقة النور'] },
  { id: 'demo-s2', studentCode: 'ST-1002', fullName: 'سلمى محمود', phone: '01123456789', guardianName: 'محمود علي', guardianPhone: '01187654321', status: 'active', joinedOn: day(-110), subscriptionStatus: 'partial', circles: ['حلقة النور'] },
  { id: 'demo-s3', studentCode: 'ST-1003', fullName: 'حبيبة يوسف', phone: '01234567890', guardianName: 'يوسف إبراهيم', guardianPhone: '01276543210', status: 'active', joinedOn: day(-95), subscriptionStatus: 'unpaid', circles: ['حلقة الفرقان'] },
  { id: 'demo-s4', studentCode: 'ST-1004', fullName: 'ملك عمرو', phone: '01011112222', guardianName: 'عمرو حسن', guardianPhone: '01033334444', status: 'active', joinedOn: day(-80), subscriptionStatus: 'paid', circles: ['حلقة الفرقان'] },
  { id: 'demo-s5', studentCode: 'ST-1005', fullName: 'جنى خالد', phone: '01155556666', guardianName: 'خالد مصطفى', guardianPhone: '01177778888', status: 'active', joinedOn: day(-75), subscriptionStatus: 'partial', circles: ['حلقة جزء تبارك'] },
  { id: 'demo-s6', studentCode: 'ST-1006', fullName: 'رقية إبراهيم', phone: '01299990000', guardianName: 'إبراهيم سامي', guardianPhone: '01212121212', status: 'active', joinedOn: day(-60), subscriptionStatus: 'not-set', circles: ['حلقة جزء تبارك'] },
  { id: 'demo-s7', studentCode: 'ST-1007', fullName: 'هاجر سامي', phone: '01050505050', guardianName: 'سامي فتحي', guardianPhone: '01060606060', status: 'paused', joinedOn: day(-45), subscriptionStatus: 'unpaid', circles: ['حلقة النور'] },
  { id: 'demo-s8', studentCode: 'ST-1008', fullName: 'فاطمة حسن', phone: '01140404040', guardianName: 'حسن عادل', guardianPhone: '01130303030', status: 'active', joinedOn: day(-30), subscriptionStatus: 'paid', circles: ['حلقة الفرقان'] },
]

export const demoTeachers: SupervisorTeacher[] = [
  { id: 'demo-t1', fullName: 'أسماء عمران', phone: '01238123881', status: 'active', hourlyRate: null, circleCount: 2, studentCount: 7, presentThisMonth: 16, missedThisMonth: 1 },
  { id: 'demo-t2', fullName: 'هدى مصطفى', phone: '01011223344', status: 'active', hourlyRate: null, circleCount: 1, studentCount: 3, presentThisMonth: 14, missedThisMonth: 2 },
  { id: 'demo-t3', fullName: 'نور الهدى', phone: '01155667788', status: 'active', hourlyRate: null, circleCount: 1, studentCount: 2, presentThisMonth: 15, missedThisMonth: 0 },
]

export const demoCircles: SupervisorCircle[] = [
  {
    id: 'demo-c1', name: 'حلقة النور', teacherId: 'demo-t1', teacherName: 'أسماء عمران', isActive: true, startsOn: day(-150),
    monthlyFee: null, studentCount: 3,
    schedule: [{ dayOfWeek: 0, startsAt: '16:00', durationMinutes: 60 }, { dayOfWeek: 3, startsAt: '16:00', durationMinutes: 60 }],
  },
  {
    id: 'demo-c2', name: 'حلقة الفرقان', teacherId: 'demo-t1', teacherName: 'أسماء عمران', isActive: true, startsOn: day(-130),
    monthlyFee: null, studentCount: 3,
    schedule: [{ dayOfWeek: 1, startsAt: '17:30', durationMinutes: 90 }, { dayOfWeek: 4, startsAt: '17:30', durationMinutes: 90 }],
  },
  {
    id: 'demo-c3', name: 'حلقة جزء تبارك', teacherId: 'demo-t2', teacherName: 'هدى مصطفى', isActive: true, startsOn: day(-90),
    monthlyFee: null, studentCount: 2,
    schedule: [{ dayOfWeek: 2, startsAt: '20:00', durationMinutes: 60 }, { dayOfWeek: 6, startsAt: '20:00', durationMinutes: 60 }],
  },
  {
    id: 'demo-c4', name: 'حلقة الإسراء', teacherId: 'demo-t3', teacherName: 'نور الهدى', isActive: true, startsOn: day(-60),
    monthlyFee: null, studentCount: 2,
    schedule: [{ dayOfWeek: 5, startsAt: '18:00', durationMinutes: 60 }],
  },
]

export const demoAbsences: SupervisorAbsencesResponse = {
  date: today,
  absences: [
    { attendanceId: 'demo-a1', date: today, studentId: 'demo-s4', studentName: 'ملك عمرو', studentCode: 'ST-1004', guardianPhone: '01033334444', circleName: 'حلقة الفرقان', teacherName: 'أسماء عمران', status: 'absent', note: 'بدون عذر', markedAt: new Date().toISOString() },
    { attendanceId: 'demo-a2', date: today, studentId: 'demo-s5', studentName: 'جنى خالد', studentCode: 'ST-1005', guardianPhone: '01177778888', circleName: 'حلقة جزء تبارك', teacherName: 'هدى مصطفى', status: 'excused', note: 'عذر طبي', markedAt: new Date().toISOString() },
  ],
  students: [
    { attendanceId: 'demo-a1', date: today, studentId: 'demo-s4', studentName: 'ملك عمرو', studentCode: 'ST-1004', guardianPhone: '01033334444', circleName: 'حلقة الفرقان', teacherName: 'أسماء عمران', status: 'absent', note: 'بدون عذر', markedAt: new Date().toISOString() },
    { attendanceId: 'demo-a2', date: today, studentId: 'demo-s5', studentName: 'جنى خالد', studentCode: 'ST-1005', guardianPhone: '01177778888', circleName: 'حلقة جزء تبارك', teacherName: 'هدى مصطفى', status: 'excused', note: 'عذر طبي', markedAt: new Date().toISOString() },
  ],
  teachers: [
    { teacherId: 'demo-t3', teacherName: 'نور الهدى', phone: '01155667788', circleId: 'demo-c4', circleName: 'حلقة الإسراء', scheduleSlotId: 'demo-slot-4', startsAt: '18:00', durationMinutes: 60 },
    { teacherId: 'demo-t2', teacherName: 'هدى مصطفى', phone: '01011223344', circleId: 'demo-c3', circleName: 'حلقة جزء تبارك', scheduleSlotId: 'demo-slot-3', startsAt: '20:00', durationMinutes: 60 },
  ],
  counts: { students: 2, teachers: 2 },
}

export const demoLive: SupervisorLiveResponse = {
  now: new Date().toISOString(),
  date: today,
  sessions: [
    { sessionId: 'demo-live-1', circleName: 'حلقة النور', teacherName: 'أسماء عمران', date: today, scheduledStart: '16:00', scheduledMinutes: 60, startedAt: new Date(Date.now() - 32 * 60000).toISOString(), endedAt: null, status: 'in_progress', actualMinutes: 32, lateMinutes: 0, overtimeMinutes: 0, undertimeMinutes: 0, note: null, studentCount: 3, attendanceId: null, payableMinutes: null, payableAmount: null },
    { sessionId: 'demo-live-2', circleName: 'حلقة الفرقان', teacherName: 'أسماء عمران', date: today, scheduledStart: '17:30', scheduledMinutes: 90, startedAt: new Date(Date.now() - 96 * 60000).toISOString(), endedAt: new Date(Date.now() - 6 * 60000).toISOString(), status: 'awaiting_attendance', actualMinutes: 90, lateMinutes: 3, overtimeMinutes: 0, undertimeMinutes: 0, note: 'تم إنهاء الحلقة بانتظار تسجيل الطالبات.', studentCount: 3, attendanceId: null, payableMinutes: 90, payableAmount: null },
  ],
}

export const demoUnpaid: SupervisorUnpaidResponse = {
  month: today.slice(0, 7), today, canViewAmounts: true, count: 3,
  unpaid: [
    { chargeId: 'demo-u1', studentId: 'demo-s1', billingMonth: today.slice(0, 7), studentName: 'مريم أحمد', studentCode: 'ST-1001', guardianPhone: '01098765432', joinedOn: day(-120), circleName: 'حلقة النور', teacherName: 'أسماء عمران', amountDue: 350, paidAmount: 150, balance: 200, status: 'partial' },
    { chargeId: 'demo-u2', studentId: 'demo-s3', billingMonth: today.slice(0, 7), studentName: 'حبيبة يوسف', studentCode: 'ST-1003', guardianPhone: '01276543210', joinedOn: day(-95), circleName: 'حلقة الفرقان', teacherName: 'أسماء عمران', amountDue: 350, paidAmount: 0, balance: 350, status: 'unpaid' },
    { chargeId: 'demo-u3', studentId: 'demo-s5', billingMonth: today.slice(0, 7), studentName: 'جنى خالد', studentCode: 'ST-1005', guardianPhone: '01177778888', joinedOn: day(-75), circleName: 'حلقة جزء تبارك', teacherName: 'هدى مصطفى', amountDue: 300, paidAmount: 100, balance: 200, status: 'partial' },
  ],
}

export const demoTeacherAttendance: SupervisorTeacherAttendanceRow[] = [
  { scheduleSlotId: 'demo-slot-1', circleId: 'demo-c1', circleName: 'حلقة النور', teacherId: 'demo-t1', teacherName: 'أسماء عمران', startsAt: '16:00', durationMinutes: 60, attendanceId: 'demo-att-1', status: 'present', payableMinutes: 60, actualMinutes: 60, overtimeMinutes: 5, undertimeMinutes: 0, note: 'بدأت في الموعد' },
  { scheduleSlotId: 'demo-slot-2', circleId: 'demo-c2', circleName: 'حلقة الفرقان', teacherId: 'demo-t1', teacherName: 'أسماء عمران', startsAt: '17:30', durationMinutes: 90, attendanceId: 'demo-att-2', status: 'present', payableMinutes: 85, actualMinutes: 85, overtimeMinutes: 0, undertimeMinutes: 5, note: null },
  { scheduleSlotId: 'demo-slot-3', circleId: 'demo-c3', circleName: 'حلقة جزء تبارك', teacherId: 'demo-t2', teacherName: 'هدى مصطفى', startsAt: '20:00', durationMinutes: 60, attendanceId: null, status: 'missing', payableMinutes: null, actualMinutes: null, overtimeMinutes: 0, undertimeMinutes: 0, note: null },
  { scheduleSlotId: 'demo-slot-4', circleId: 'demo-c4', circleName: 'حلقة الإسراء', teacherId: 'demo-t3', teacherName: 'نور الهدى', startsAt: '18:00', durationMinutes: 60, attendanceId: 'demo-att-4', status: 'present', payableMinutes: 60, actualMinutes: 60, overtimeMinutes: 0, undertimeMinutes: 0, note: null },
]

export const demoStudentAttendance: SupervisorStudentAttendanceRow[] = [
  { attendanceId: 'demo-sa1', date: today, studentId: 'demo-s1', studentCode: 'ST-1001', studentName: 'مريم أحمد', circleId: 'demo-c1', circleName: 'حلقة النور', startsAt: '16:00', status: 'present', note: null },
  { attendanceId: 'demo-sa2', date: today, studentId: 'demo-s2', studentCode: 'ST-1002', studentName: 'سلمى محمود', circleId: 'demo-c1', circleName: 'حلقة النور', startsAt: '16:00', status: 'present', note: null },
  { attendanceId: 'demo-sa3', date: today, studentId: 'demo-s4', studentCode: 'ST-1004', studentName: 'ملك عمرو', circleId: 'demo-c2', circleName: 'حلقة الفرقان', startsAt: '17:30', status: 'absent', note: 'بدون عذر' },
  { attendanceId: 'demo-sa4', date: today, studentId: 'demo-s5', studentCode: 'ST-1005', studentName: 'جنى خالد', circleId: 'demo-c3', circleName: 'حلقة جزء تبارك', startsAt: '20:00', status: 'excused', note: 'عذر طبي' },
  { attendanceId: 'demo-sa5', date: today, studentId: 'demo-s6', studentCode: 'ST-1006', studentName: 'رقية إبراهيم', circleId: 'demo-c3', circleName: 'حلقة جزء تبارك', startsAt: '20:00', status: 'present', note: null },
]

function note(id: string, text: string, daysAgo: number) {
  return { id, text, createdAt: new Date(Date.now() - daysAgo * 86400000).toISOString(), createdBy: 'أسماء عمران' }
}

export function demoStudentDetail(id: string): SupervisorStudentDetailResponse {
  const student = demoStudents.find((item) => item.id === id) ?? demoStudents[0]
  return {
    student: {
      id: student.id, studentCode: student.studentCode, fullName: student.fullName, phone: student.phone,
      guardianName: student.guardianName, guardianPhone: student.guardianPhone, status: student.status,
      joinedOn: student.joinedOn, notes: null,
      circles: student.circles.map((name, index) => ({ id: `demo-c${index + 1}`, name })),
    },
    period: { from: day(-30), to: today },
    attendance: { present: 18, absent: 2, excused: 1, marked: 21, rate: 85.7 },
    history: [
      { date: today, circleName: student.circles[0], startsAt: '16:00', status: 'present', note: null },
      { date: day(-2), circleName: student.circles[0], startsAt: '16:00', status: 'present', note: null },
      { date: day(-4), circleName: student.circles[0], startsAt: '16:00', status: 'absent', note: 'بدون عذر' },
      { date: day(-7), circleName: student.circles[0], startsAt: '16:00', status: 'excused', note: 'عذر طبي' },
      { date: day(-9), circleName: student.circles[0], startsAt: '16:00', status: 'present', note: null },
    ],
    notes: [note('demo-n1', 'تحسن واضح في التلاوة هذا الشهر، تحتاج متابعة في المدود.', 3), note('demo-n2', 'تم التواصل مع ولي الأمر بخصوص الغياب.', 8)],
    subscription: [{ circleName: student.circles[0], status: 'partial', amountDue: null, paidAmount: null, balance: null }],
  }
}

export function demoTeacherDetail(id: string): SupervisorTeacherDetailResponse {
  const teacher = demoTeachers.find((item) => item.id === id) ?? demoTeachers[0]
  return {
    teacher: { id: teacher.id, fullName: teacher.fullName, phone: teacher.phone, status: teacher.status, hourlyRate: null },
    period: { from: day(-30), to: today },
    attendance: { scheduled: 20, present: 18, absent: 1, cancelled: 0, rate: 90, hours: 18.5, overtimeMinutes: 35, undertimeMinutes: 20 },
    circles: demoCircles.filter((circle) => circle.teacherId === teacher.id).map((circle) => ({ id: circle.id, name: circle.name, isActive: circle.isActive, studentCount: circle.studentCount })),
    history: [
      { id: 'demo-th1', date: today, circleName: 'حلقة النور', startsAt: '16:00', status: 'present', durationMinutes: 60, actualMinutes: 60, overtimeMinutes: 5, undertimeMinutes: 0, note: 'بدأت في الموعد', payableAmount: null, presentStudents: 3, absentStudents: 0 },
      { id: 'demo-th2', date: day(-1), circleName: 'حلقة الفرقان', startsAt: '17:30', status: 'present', durationMinutes: 90, actualMinutes: 85, overtimeMinutes: 0, undertimeMinutes: 5, note: null, payableAmount: null, presentStudents: 2, absentStudents: 1 },
      { id: 'demo-th3', date: day(-3), circleName: 'حلقة النور', startsAt: '16:00', status: 'present', durationMinutes: 60, actualMinutes: 60, overtimeMinutes: 0, undertimeMinutes: 0, note: null, payableAmount: null, presentStudents: 3, absentStudents: 0 },
    ],
    notes: [note('demo-tn1', 'التزام ممتاز بمواعيد الحلقات، ومتابعة جيدة للطالبات.', 2)],
  }
}

export function demoCircleDetail(id: string): SupervisorCircleDetailResponse {
  const circle = demoCircles.find((item) => item.id === id) ?? demoCircles[0]
  const roster = circle.name === 'حلقة النور' ? demoStudents.slice(0, 3) : demoStudents.slice(2, 5)
  return {
    circle: { id: circle.id, name: circle.name, teacherId: circle.teacherId, teacherName: circle.teacherName, isActive: circle.isActive, startsOn: circle.startsOn, monthlyFee: null },
    studentCount: roster.length,
    roster: roster.map((student) => ({
      id: student.id, studentCode: student.studentCode, fullName: student.fullName,
      guardianName: student.guardianName, guardianPhone: student.guardianPhone,
      studentStatus: student.status, enrollmentStatus: 'active', enrolledOn: student.joinedOn,
    })),
    schedule: circle.schedule,
    sessions: [
      { date: today, status: 'present', startsAt: circle.schedule[0].startsAt, durationMinutes: circle.schedule[0].durationMinutes, note: null, presentStudents: roster.length - 1, missingStudents: 1 },
      { date: day(-3), status: 'present', startsAt: circle.schedule[0].startsAt, durationMinutes: circle.schedule[0].durationMinutes, note: null, presentStudents: roster.length, missingStudents: 0 },
    ],
  }
}

export const demoTeacherNotes: SupervisorTeacherNote[] = [
  { kind: 'session', teacherId: 'demo-t1', teacherName: 'أسماء عمران', circleName: 'حلقة النور', date: today, note: 'بدأت في الموعد، ومجموعة التلاوة كانت ممتازة.', markedAt: new Date().toISOString(), studentName: null, studentCode: null },
  { kind: 'student', teacherId: 'demo-t1', teacherName: 'أسماء عمران', circleName: 'حلقة النور', date: today, note: 'مريم تحتاج متابعة في أحكام المدود، تم التنبيه عليها.', markedAt: new Date().toISOString(), studentName: 'مريم أحمد', studentCode: 'ST-1001' },
  { kind: 'student', teacherId: 'demo-t2', teacherName: 'هدى مصطفى', circleName: 'حلقة جزء تبارك', date: today, note: 'جنى كانت متعبة اليوم، تم التواصل مع ولي الأمر.', markedAt: new Date().toISOString(), studentName: 'جنى خالد', studentCode: 'ST-1005' },
  { kind: 'session', teacherId: 'demo-t2', teacherName: 'هدى مصطفى', circleName: 'حلقة جزء تبارك', date: day(-1), note: 'تمت مراجعة الجزء كاملًا، والطالبات جاهزات للتسميع القادم.', markedAt: new Date(Date.now() - 86400000).toISOString(), studentName: null, studentCode: null },
]

export const demoRequests: SupervisorAttendanceRequest[] = [
  { id: 'demo-r1', type: 'absence', teacherName: 'أسماء عمران', teacherId: 'demo-t1', circleName: 'حلقة النور', circleId: 'demo-c1', date: today, reason: 'ظرف عائلي طارئ، أرجو اعتماد الغياب.', status: 'pending', createdAt: new Date().toISOString(), reviewNote: null, reviewedAt: null, payload: null, attendanceId: null },
  { id: 'demo-r2', type: 'correction', teacherName: 'هدى مصطفى', teacherId: 'demo-t2', circleName: 'حلقة جزء تبارك', circleId: 'demo-c3', date: day(-1), reason: 'الحلقة استمرت 75 دقيقة وتم تسجيل 60 فقط.', status: 'pending', createdAt: new Date().toISOString(), reviewNote: null, reviewedAt: null, payload: '{"durationMinutes":75}', attendanceId: 'demo-att-3' },
]


