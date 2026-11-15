import type { Branding, AdExpenseForm, OperatingExpenseForm, StudentForm, TeacherForm, CircleForm, EnrollmentForm, ChargeForm, PaymentForm } from './types'
import { localDateString, currentMonth } from '../lib/dates'

export const defaultBranding: Branding = { brandName: 'دار الإمام حفص للقرآن والتجويد', logoDataUrl: null, facebookUrl: null, tiktokUrl: null, whatsappUrl: null }
export const weekDays = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
export const blankAdExpense = (): AdExpenseForm => ({ circleId: '', platform: '', startDate: localDateString(), daysCount: '1', dailyCost: '0', note: '' })
export const blankOperatingExpense = (): OperatingExpenseForm => ({ expenseDate: localDateString(), category: '', description: '', amount: '', circleId: '', note: '' })
export const blankStudent = (): StudentForm => ({ studentCode: '', fullName: '', ageYears: '', phone: '', guardianName: '', guardianPhone: '', joinedOn: localDateString(), status: 'active', notes: '' })
export const blankTeacher = (): TeacherForm => ({ teacherCode: '', fullName: '', phone: '', hourlyRate: '0', status: 'active', notes: '' })
export const blankCircle = (): CircleForm => ({ circleCode: '', name: '', teacherId: '', monthlyFee: '0', scheduleText: '', isActive: true, startsOn: localDateString() })
export const blankEnrollment = (studentId = '', circleId = '', fee: number | null = 0): EnrollmentForm => ({ studentId, circleId, startsOn: localDateString(), agreedMonthlyFee: fee == null ? '' : String(fee), allowClosedCircle: false })
export const blankCharge = (enrollmentId = '', month = currentMonth(), fee = 0): ChargeForm => ({ enrollmentId, billingMonth: month, amountDue: String(fee), note: '' })
export const blankPayment = (monthlyChargeId = '', balance = 0): PaymentForm => ({ monthlyChargeId, amount: String(balance), method: 'cash', reference: '', note: '' })
