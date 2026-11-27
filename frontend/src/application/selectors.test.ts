import { describe, expect, it } from 'vitest'
import type { AdExpense, AttendanceRow, Circle, CollectionRow, OperatingExpense, Student, Teacher } from '../domain/types'
import type { MonthSession } from './selectors'
import {
  getCurrentMonthTotals,
  getFilteredStudents,
  getFilteredTeachers,
  getSuggestedMonthlyCharge,
} from './selectors'

const student = (overrides: Partial<Student>): Student => ({
  id: 's1',
  studentCode: 'STD-1',
  fullName: 'طالبة تجريبية',
  ageYears: 10,
  phone: '01000000000',
  guardianName: 'ولي الأمر',
  guardianPhone: '01111111111',
  joinedOn: '2026-01-01',
  status: 'active',
  notes: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  circleNames: 'حلقة النور',
  currentMonthDue: null,
  currentMonthPaid: null,
  currentMonthPaymentStatus: null,
  ...overrides,
})

const teacher = (overrides: Partial<Teacher>): Teacher => ({
  id: 't1',
  teacherCode: 'TCH-1',
  fullName: 'معلمة تجريبية',
  phone: '01000000000',
  hourlyRate: 100,
  status: 'active',
  notes: '',
  circleNames: 'حلقة النور',
  circleCount: 1,
  ...overrides,
})

const collection = (overrides: Partial<CollectionRow>): CollectionRow => ({
  enrollmentId: 'e1',
  chargeId: 'c1',
  studentId: 's1',
  studentCode: 'STD-1',
  studentName: 'طالبة تجريبية',
  circleId: 'cir1',
  circleName: 'حلقة النور',
  teacherName: 'معلمة تجريبية',
  agreedMonthlyFee: 300,
  amountDue: 300,
  paidAmount: 0,
  balance: 0,
  note: null,
  paymentStatus: 'unpaid',
  billingMonth: '2026-01',
  enrollmentStartsOn: '2026-01-01',
  enrollmentEndsOn: null,
  circleStartsOn: '2026-01-01',
  ...overrides,
})

describe('selectors', () => {
  it('filters students by Arabic text and status', () => {
    const rows = [
      student({ id: '1', fullName: 'مريم أحمد', studentCode: 'STD-1', status: 'active' }),
      student({ id: '2', fullName: 'سارة محمود', studentCode: 'STD-2', status: 'paused', phone: '01234567890' }),
    ]

    expect(getFilteredStudents(rows, 'مريم', 'all').map(row => row.id)).toEqual(['1'])
    expect(getFilteredStudents(rows, '0123', 'all').map(row => row.id)).toEqual(['2'])
    expect(getFilteredStudents(rows, '', 'paused').map(row => row.id)).toEqual(['2'])
  })

  it('filters teachers by name and status', () => {
    const rows = [
      teacher({ id: '1', fullName: 'أسماء', teacherCode: 'TCH-1', status: 'active' }),
      teacher({ id: '2', fullName: 'هدى', teacherCode: 'TCH-2', status: 'archived' }),
    ]

    expect(getFilteredTeachers(rows, 'أسماء', 'all').map(row => row.id)).toEqual(['1'])
    expect(getFilteredTeachers(rows, '', 'archived').map(row => row.id)).toEqual(['2'])
  })

  it('sums current-month due, paid, and balance', () => {
    const totals = getCurrentMonthTotals([
      collection({ amountDue: 300, paidAmount: 100, balance: 200 }),
      collection({ chargeId: 'c2', amountDue: 200, paidAmount: 0, balance: 200 }),
    ])

    expect(totals).toEqual({ due: 500, paid: 100, balance: 400 })
  })

  it('uses the agreed monthly fee for the charge suggestion', () => {
    const row = collection({
      agreedMonthlyFee: 250,
      enrollmentStartsOn: '2026-01-16',
      circleStartsOn: '2026-01-01',
    })

    expect(getSuggestedMonthlyCharge(row)).toBe(250)
  })
})
