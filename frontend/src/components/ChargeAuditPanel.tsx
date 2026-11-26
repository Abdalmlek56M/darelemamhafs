import { useCallback, useEffect, useState } from 'react'
import { Pencil, ShieldCheck, TriangleAlert } from 'lucide-react'
import { api } from '../system/api'
import { requestPage } from '../services/apiClient'
import Pager from './common/Pager'
import { ADMIN_PAGE_SIZE } from '../lib/pagination'
import type { ChargeAuditResponse } from '../system/types'
import { money } from '../lib/formatters'
import ResponsiveTable, { type ResponsiveColumn } from './common/ResponsiveTable'
import type { DarApplicationContext } from '../application/useDarApplication'

type Props = { ctx: DarApplicationContext }
type ChargeAuditRow = ChargeAuditResponse['rows'][number]

export default function ChargeAuditPanel({ ctx }: Props) {
  const [data, setData] = useState<ChargeAuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const load = useCallback(async (month: string, requestedPage = page) => {
    setLoading(true)
    setError(null)
    try {
      const response = await requestPage<ChargeAuditResponse>(`/api/admin/charge-audit?month=${encodeURIComponent(month)}&page=${requestedPage}&pageSize=${ADMIN_PAGE_SIZE}`, undefined, ADMIN_PAGE_SIZE)
      setData(response.data)
      setTotal(response.meta.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل مراجعة الاستحقاقات.')
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => { void load(ctx.currentMonthValue, page) }, [ctx.currentMonthValue, page, load])

  const openCorrection = (row: ChargeAuditRow) => {
    ctx.setEditingChargeId(row.chargeId)
    ctx.setChargeForm({ enrollmentId: row.enrollmentId, billingMonth: ctx.currentMonthValue, amountDue: row.agreedFee.toFixed(2), note: '' })
    ctx.setChargeModal(true)
  }

  if (loading && !data) return <div className="charge-audit-panel glass"><span className="muted-text">جارٍ مراجعة الاستحقاقات…</span></div>
  if (error) return <div className="charge-audit-panel glass"><TriangleAlert size={16} /><span>{error}</span><button className="text-link" onClick={() => void load(ctx.currentMonthValue)}>إعادة المحاولة</button></div>
  if (!data || data.count === 0) {
    return <div className="charge-audit-panel glass is-clean"><ShieldCheck size={17} /><div><strong>مراجعة الاستحقاقات سليمة</strong><small>كل استحقاقات {ctx.currentMonthValue} تساوي الرسوم المتفق عليها في الالتحاق.</small></div><button className="text-link" onClick={() => void load(ctx.currentMonthValue)}>تحديث</button></div>
  }

  const columns: ResponsiveColumn<ChargeAuditRow>[] = [
    { key: 'student', header: 'الطالبة', primary: true, render: (row) => <><strong>{row.studentName}</strong><small className="sub-cell">{row.studentCode}</small></> },
    { key: 'circle', header: 'الحلقة', render: (row) => row.circleName },
    { key: 'recorded', header: 'المسجل', render: (row) => money(row.amountDue) },
    { key: 'agreed', header: 'المتفق عليه', render: (row) => money(row.agreedFee) },
    { key: 'paid', header: 'المدفوع', render: (row) => money(row.paid) },
    { key: 'difference', header: 'الفرق', render: (row) => <span className={row.difference > 0 ? 'warn-text' : 'good-text'}>{money(row.difference)}</span> },
    { key: 'balance', header: 'المتبقي بعد التصحيح', render: (row) => <span className={row.balanceAfterCorrection < 0 ? 'warn-text' : ''}>{money(row.balanceAfterCorrection)}</span> },
  ]

  return <section className="charge-audit-panel glass">
    <div className="charge-audit-head">
      <div><span className="eyebrow">مراجعة مالية</span><h3>استحقاقات لا تساوي الرسوم المتفق عليها</h3><p>عددها {total} في {data.month}. راجع كل صف وافتحه للتصحيح؛ لا يتم تعديل أي مبلغ تلقائيًا.</p></div>
      <button className="secondary-button compact-button" onClick={() => void load(ctx.currentMonthValue)} disabled={loading}>تحديث</button>
    </div>
    <ResponsiveTable
      caption="مراجعة الاستحقاقات"
      tableClassName="students-table wide-table charge-audit-table"
      rows={data.rows}
      columns={columns}
      rowKey={(row) => row.chargeId}
      empty={<span className="muted-text">لا توجد صفوف تحتاج مراجعة.</span>}
      actions={(row) => row.balanceAfterCorrection < 0
        ? <small className="warn-text">المدفوع أكبر من المتفق عليه — يحتاج مراجعة يدوية.</small>
        : <button className="secondary-button compact-button" onClick={() => openCorrection(row)}><Pencil size={13}/> فتح للتصحيح</button>}
    />
    <Pager page={page} pageSize={ADMIN_PAGE_SIZE} total={total} onPageChange={setPage} label="صف" />
  </section>
}
