import { describe, expect, it } from 'vitest'
import type { CollectionRow } from '../domain/types'
import {
  INVALID_NEW_STUDENT_STATUS_MESSAGE,
  paymentOverBalanceMessage,
  remainingAmountForCharge,
  validateNewStudentStatus,
  validatePaymentAmount,
} from './validation'

const collection = (overrides: Partial<CollectionRow>): CollectionRow => ({
  enrollmentId: 'e1',
  chargeId: 'c1',
  studentId: 's1',
  studentCode: 'STD-1',
  studentName: 'طالبة',
  circleId: 'cir1',
  circleName: 'حلقة النور',
  teacherName: 'معلمة',
  agreedMonthlyFee: 300,
  amountDue: 300,
  paidAmount: 100,
  balance: 200,
  note: null,
  paymentStatus: 'partial',
  billingMonth: '2026-11',
  enrollmentStartsOn: '2026-01-01',
  enrollmentEndsOn: null,
  circleStartsOn: '2026-01-01',
  ...overrides,
})

describe('payment remaining-amount validation', () => {
  it('finds the remaining balance of the monthly charge being paid', () => {
    expect(remainingAmountForCharge([collection({})], 'c1')).toBe(200)
    expect(remainingAmountForCharge([collection({ balance: 0 })], 'c1')).toBe(0)
    expect(remainingAmountForCharge([], 'c1')).toBeNull()
    expect(remainingAmountForCharge([collection({})], 'other')).toBeNull()
  })

  it('rejects an amount larger than the remainder with the server-side expected message', () => {
    expect(validatePaymentAmount('200.01', 200)).toEqual({ ok: false, error: paymentOverBalanceMessage(200) })
    expect(paymentOverBalanceMessage(200)).toBe('المبلغ أكبر من المتبقي (200.00). سجّل مبلغًا مساويًا أو أقل من المتبقي.')
  })

  it('accepts an amount equal to or below the remainder', () => {
    expect(validatePaymentAmount('200', 200)).toEqual({ ok: true, value: 200 })
    expect(validatePaymentAmount('150.50', 200)).toEqual({ ok: true, value: 150.5 })
  })

  it('falls back to the shared money parser for invalid input and leaves unknown remainders to the server', () => {
    expect(validatePaymentAmount('abc', 200).ok).toBe(false)
    expect(validatePaymentAmount('0', 200).ok).toBe(false)
    expect(validatePaymentAmount('999999', null)).toEqual({ ok: true, value: 999999 })
  })
})

describe('new student status validation', () => {
  it('rejects creating a student as withdrawn or archived', () => {
    expect(validateNewStudentStatus('withdrawn', false)).toBe(INVALID_NEW_STUDENT_STATUS_MESSAGE)
    expect(validateNewStudentStatus('archived', false)).toBe(INVALID_NEW_STUDENT_STATUS_MESSAGE)
  })

  it('allows active/paused creation and keeps editing any existing status', () => {
    expect(validateNewStudentStatus('active', false)).toBeNull()
    expect(validateNewStudentStatus('paused', false)).toBeNull()
    for (const status of ['active', 'paused', 'withdrawn', 'archived'] as const) {
      expect(validateNewStudentStatus(status, true)).toBeNull()
    }
  })
})
