import { useEffect, useState } from 'react'
import { request } from '../services/apiClient'

export type ProfitDashboardSummary = {
  billed: number
  collected: number
  balance: number
  advertising: number
  teacherPay: number
  otherExpenses: number
  net: number
  withoutChargeCount: number
}

export type ProfitTeacherSummary = {
  teacherId: string
  teacherName: string
  sessions: number
  hours: number
  payable: number
  avgHourlyRate: number
}

export type ProfitCircleSummary = {
  circleId: string
  circleName: string
  billed: number
  collected: number
  advertising: number
  teacherPay: number
  linkedExpenses: number
  uncharged: number
  net: number
}

export type ProfitSummary = {
  month: string
  dashboard: ProfitDashboardSummary
  teachers: ProfitTeacherSummary[]
  circles: ProfitCircleSummary[]
}

/** FINAL 0.3: the dashboard and profit reports read the server calculation. */
export default function useProfitSummary(month: string, enabled: boolean) {
  const [data, setData] = useState<ProfitSummary | null>(null)
  useEffect(() => {
    if (!enabled) { setData(null); return }
    let active = true
    request<ProfitSummary>(`/api/summary/profit?month=${encodeURIComponent(month)}`)
      .then((value) => { if (active) setData(value) })
      .catch(() => { if (active) setData(null) })
    return () => { active = false }
  }, [month, enabled])
  return data
}
