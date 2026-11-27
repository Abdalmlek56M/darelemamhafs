import { describe, expect, it, vi } from 'vitest'
import { downloadProfitSummary } from './profitSummaryReport'

const { safeDownload } = vi.hoisted(() => ({ safeDownload: vi.fn() }))
vi.mock('../lib/reportExports', () => ({ safeDownload }))

const dashboardProfit = {
  billed: 1000,
  collected: 400,
  balance: 600,
  teacherPay: 250,
  advertising: 50,
  otherExpenses: 25,
  net: 75,
  withoutChargeCount: 0,
  unmarkedPastSessions: 0,
}

function exportedCsv() {
  safeDownload.mockClear()
  downloadProfitSummary({
    brandName: '=HYPERLINK("http://evil.example")',
    currentMonthValue: '2026-11',
    dashboardProfit,
    teacherPaySummary: [{ teacherId: 't1', teacherName: 'أسماء', sessions: 10, hours: 8.5, payable: 850, avgHourlyRate: 100 }],
    circleProfitSummary: [{ circleId: 'c1', circleName: 'حلقة النور', billed: 1000, collected: 400, advertising: 50, teacherPay: 250, linkedExpenses: 25, uncharged: 0, net: 75 }],
  })
  const [, csv] = safeDownload.mock.calls[0] as [string, string, string]
  return csv
}

describe('profit summary CSV export', () => {
  it('neutralizes formula-injection payloads in the exported values (school name)', () => {
    const csv = exportedCsv()
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"")"`)
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"")"`)
    expect(csv.startsWith('\ufeff')).toBe(true)
  })
})
