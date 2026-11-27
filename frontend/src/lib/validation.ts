import type { CollectionRow, StudentStatus } from '../domain/types'
import { parseMoneyInput, toMinorUnits, type MoneyParseResult } from './money'

/**
 * Mirrors the legacy API's 409 for overpayment so the user sees the same text
 * before the request; the server remains the final guard.
 */
export function paymentOverBalanceMessage(remaining: number): string {
  return `المبلغ أكبر من المتبقي (${remaining.toFixed(2)}). سجّل مبلغًا مساويًا أو أقل من المتبقي.`
}

/** Outstanding balance of the charge being paid, or null when it is not loaded (server-side validation only). */
export function remainingAmountForCharge(collections: CollectionRow[], monthlyChargeId: string): number | null {
  const row = collections.find(item => item.chargeId === monthlyChargeId)
  return row ? Math.max(0, row.balance) : null
}

/** Validate a payment amount against the remaining balance of its monthly charge. */
export function validatePaymentAmount(raw: string, remaining: number | null): MoneyParseResult {
  const parsed = parseMoneyInput(raw)
  if (!parsed.ok) return parsed
  if (remaining !== null && toMinorUnits(parsed.value) > toMinorUnits(remaining)) {
    return { ok: false, error: paymentOverBalanceMessage(remaining) }
  }
  return parsed
}

/** A brand-new student starts active/paused; withdrawn/archived are transitions, not a starting state. */
export const INVALID_NEW_STUDENT_STATUS_MESSAGE =
  'لا يمكن إنشاء طالب بحالة «منسحب» أو «مؤرشف». اختر «نشط» أو «موقوف مؤقتًا»، ثم غيّر الحالة لاحقًا من سجل الطلاب.'

export function validateNewStudentStatus(status: StudentStatus, editing: boolean): string | null {
  if (editing) return null
  return status === 'withdrawn' || status === 'archived' ? INVALID_NEW_STUDENT_STATUS_MESSAGE : null
}
