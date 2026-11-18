import { useCallback, useEffect, useState } from 'react'
import { Pencil, ShieldCheck, TriangleAlert } from 'lucide-react'
import { api } from '../system/api'
import type { ChargeAuditResponse } from '../system/types'
import { money } from '../lib/formatters'
import type { DarApplicationContext } from '../application/useDarApplication'

type Props = { ctx: DarApplicationContext }

export default function ChargeAuditPanel({ ctx }: Props) {
  const [data, setData] = useState<ChargeAuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (month: string) => {
    setLoading(true)
    setError(null)
    try {
      setData(await api<ChargeAuditResponse>(`/api/admin/charge-audit?month=${encodeURIComponent(month)}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل مراجعة الاستحقاقات.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(ctx.currentMonthValue) }, [ctx.currentMonthValue, load])

  const openCorrection = (row: ChargeAuditResponse['rows'][number]) => {
    ctx.setEditingChargeId(row.chargeId)
    ctx.setChargeForm({
      enrollmentId: row.enrollmentId,
      billingMonth: ctx.currentMonthValue,
      amountDue: row.agreedFee.toFixed(2),
      note: '',
    })
    ctx.setChargeModal(true)
  }

  if (loading && !data) return <div className="charge-audit-panel glass"><span className="muted-text">جارٍ مراجعة الاستحقاقات…</span></div>
  if (error) return <div className="charge-audit-panel glass"><TriangleAlert size={16} /><span>{error}</span><button className="text-link" onClick={() => void load(ctx.currentMonthValue)}>إعادة المحاولة</button></div>
  if (!data || data.count === 0) {
    return <div className="charge-audit-panel glass is-clean"><ShieldCheck size={17} /><div><strong>مراجعة الاستحقاقات سليمة</strong><small>كل استحقاقات {ctx.currentMonthValue} تساوي الرسوم المتفق عليها في الالتحاق.</small></div><button className="text-link" onClick={() => void load(ctx.currentMonthValue)}>تحديث</button></div>
  }

  return <section className="charge-audit-panel glass">
    <div className="charge-audit-head">
      <div><span className="eyebrow">مراجعة مالية</span><h3>استحقاقات لا تساوي الرسوم المتفق عليها</h3><p>عددها {data.count} في {data.month}. راجع كل صف وافتحه للتصحيح؛ لا يتم تعديل أي مبلغ تلقائيًا.</p></div>
      <button className="secondary-button compact-button" onClick={() => void load(ctx.currentMonthValue)} disabled={loading}>تحديث</button>
    </div>
    <div className="table-scroll">
      <table className="students-table wide-table charge-audit-table">
        <thead><tr><th>الطالبة</th><th>الحلقة</th><th>المسجل</th><th>المتفق عليه</th><th>المدفوع</th><th>الفرق</th><th>المتبقي بعد التصحيح</th><th>إجراء</th></tr></thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.chargeId}>
              <td><strong>{row.studentName}</strong><small className="sub-cell">{row.studentCode}</small></td>
              <td>{row.circleName}</td>
              <td>{money(row.amountDue)}</td>
              <td>{money(row.agreedFee)}</td>
              <td>{money(row.paid)}</td>
              <td className={row.difference > 0 ? 'warn-text' : 'good-text'}>{money(row.difference)}</td>
              <td className={row.balanceAfterCorrection < 0 ? 'warn-text' : ''}>{money(row.balanceAfterCorrection)}</td>
              <td>
                {row.balanceAfterCorrection < 0
                  ? <small className="warn-text">المدفوع أكبر من المتفق عليه — يحتاج مراجعة يدوية.</small>
                  : <button className="secondary-button compact-button" onClick={() => openCorrection(row)}><Pencil size={13} /> فتح للتصحيح</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
}
