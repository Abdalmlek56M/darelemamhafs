import { describe, expect, it } from 'vitest'
import type { CollectionRow } from '../domain/types'
import { toCsv } from './reportExports'

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
  balance: 300,
  note: null,
  paymentStatus: 'unpaid',
  billingMonth: '2026-11',
  enrollmentStartsOn: '2026-01-01',
  enrollmentEndsOn: null,
  circleStartsOn: '2026-01-01',
  ...overrides,
})

describe('collection CSV export', () => {
  it('starts with a UTF-8 BOM and keeps the normal Arabic header/rows intact', () => {
    const csv = toCsv([collection({})])
    expect(csv.startsWith('\ufeff')).toBe(true)
    expect(csv).toContain('"الطالب"')
    expect(csv).toContain('"طالبة تجريبية"')
    expect(csv).toContain('"300"')
  })

  it('neutralizes spreadsheet formula injection coming from data cells', () => {
    const csv = toCsv([
      collection({ studentName: '=HYPERLINK("http://evil.example","اضغط")' }),
      collection({ studentName: 'سارة', studentCode: '+2026', circleName: '-حلقة', teacherName: '@cmd' }),
    ])
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""اضغط"")"`)
    expect(csv).toContain(`"'+2026"`)
    expect(csv).toContain(`"'-حلقة"`)
    expect(csv).toContain(`"'@cmd"`)
    // exactly one quoting prefix, and the row count is unchanged
    expect(csv.split('\r\n')).toHaveLength(3)
  })
})
