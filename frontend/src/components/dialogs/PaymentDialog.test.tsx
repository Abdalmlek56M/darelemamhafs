// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import PaymentDialog from './PaymentDialog'
import type { DarApplicationContext } from '../../application/useDarApplication'
import type { CollectionRow } from '../../domain/types'
import { paymentOverBalanceMessage } from '../../lib/validation'

const collection = (): CollectionRow => ({
  enrollmentId: 'e1',
  chargeId: 'ch1',
  studentId: 's1',
  studentCode: 'STD-1',
  studentName: 'مريم',
  circleId: 'cir1',
  circleName: 'حلقة النور',
  teacherName: 'أسماء',
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
})

function makeCtx({ amount = '500', collections = [collection()] as CollectionRow[] } = {}) {
  return {
    collections,
    paymentForm: { monthlyChargeId: 'ch1', amount, method: 'cash', reference: '', note: '' },
    paymentReceipt: null,
    paymentReceiptPreview: null,
    saving: false,
    setPaymentForm: vi.fn(),
    setPaymentModal: vi.fn(),
    setPaymentReceipt: vi.fn(),
    setPaymentReceiptPreview: vi.fn(),
    setToast: vi.fn(),
    savePayment: vi.fn(() => Promise.resolve()),
  } as unknown as DarApplicationContext
}

afterEach(() => cleanup())

describe('PaymentDialog remaining-amount cap', () => {
  it('caps the amount input at the remaining balance and shows it', () => {
    render(<PaymentDialog ctx={makeCtx()} />)
    const input = screen.getByLabelText('المبلغ المدفوع') as HTMLInputElement
    expect(input.getAttribute('max')).toBe('200.00')
    expect(input.getAttribute('min')).toBe('0.01')
    expect(document.body.textContent).toContain('المتبقي على هذا الاستحقاق')
  })

  it('rejects an amount above the remaining balance with the server-side expected message and never submits', () => {
    const ctx = makeCtx({ amount: '500' })
    render(<PaymentDialog ctx={ctx} />)
    fireEvent.click(screen.getByRole('button', { name: /حفظ التحصيل/ }))
    const expected = paymentOverBalanceMessage(200)
    expect(ctx.savePayment).not.toHaveBeenCalled()
    expect(ctx.setToast).toHaveBeenCalledWith({ tone: 'error', text: expected })
    expect(screen.getByRole('alert').textContent).toBe(expected)
  })

  it('submits an amount equal to the remaining balance', () => {
    const ctx = makeCtx({ amount: '200' })
    render(<PaymentDialog ctx={ctx} />)
    fireEvent.click(screen.getByRole('button', { name: /حفظ التحصيل/ }))
    expect(ctx.savePayment).toHaveBeenCalledTimes(1)
    expect(ctx.setToast).not.toHaveBeenCalled()
  })

  it('does not cap the input when the charge is not in the loaded collection and lets the server validate', () => {
    const ctx = makeCtx({ amount: '500', collections: [] })
    render(<PaymentDialog ctx={ctx} />)
    const input = screen.getByLabelText('المبلغ المدفوع') as HTMLInputElement
    expect(input.hasAttribute('max')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /حفظ التحصيل/ }))
    expect(ctx.savePayment).toHaveBeenCalledTimes(1)
  })
})
