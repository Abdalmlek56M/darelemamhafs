import { useCallback } from 'react'
import { RefreshCw, Wallet } from 'lucide-react'
import { teacherApi } from './teacherApi'
import type { SupervisorUnpaidResponse } from './teacherTypes'
import { money } from './teacherFormat'
import { demoUnpaid } from './supervisorDemo'
import Pager from '../components/common/Pager'
import { usePagedResource } from '../hooks/usePagedResource'
import { defaultMeta } from '../lib/pagination'
import WhatsAppButton from './WhatsAppButton'

type Props = { demo: boolean; canFinance: boolean; canCommunicate?: boolean }

export default function SupervisorUnpaid({ demo, canFinance, canCommunicate = false }: Props) {
  const fetchUnpaid = useCallback(async (page: number, pageSize: number) => {
    if (demo) return { items: [demoUnpaid], meta: defaultMeta(demoUnpaid.unpaid.length, 1, pageSize) }
    const response = await teacherApi.supervisorUnpaidPage({ page, pageSize })
    return { items: [response.data], meta: response.meta }
  }, [demo])
  const unpaidPage = usePagedResource<SupervisorUnpaidResponse>({ fetcher: fetchUnpaid, deps: [demo] })
  const data = unpaidPage.items[0] ?? null
  const items = data?.unpaid ?? []
  const showAmounts = canFinance && (data?.canViewAmounts ?? false)
  const remaining = items.reduce((sum, item) => sum + (item.balance ?? 0), 0)
  const due = items.reduce((sum, item) => sum + (item.amountDue ?? 0), 0)
  const partial = items.filter((item) => item.status === 'partial').length

  return (
    <div className="sup-page">
      <div className="sup-page-head">
        <div><span className="sup-eyebrow">متابعة الاشتراكات</span><h1>المتأخرات</h1><p>مين متأخر في الاشتراك، بدون كشف المبالغ إلا لمن يملك صلاحية المالية.</p></div>
        <button className="sup-icon-button" onClick={unpaidPage.reload} disabled={unpaidPage.loading} aria-label="تحديث"><RefreshCw size={18} /></button>
      </div>

      {unpaidPage.error && <div className="t-error-card"><p>{unpaidPage.error}</p><button className="t-secondary" onClick={unpaidPage.reload}>إعادة المحاولة</button></div>}

      <div className="sup-kpi-grid sup-kpi-grid-three">
        <div className="sup-kpi"><span className="sup-kpi-icon is-warn"><Wallet size={18} /></span><span>عدد المتأخرات</span><strong>{unpaidPage.meta.total}</strong><small>{partial} حالة جزئية في الصفحة</small></div>
        {showAmounts ? (
          <>
            <div className="sup-kpi"><span className="sup-kpi-icon"><Wallet size={18} /></span><span>إجمالي المتبقي</span><strong>{money(remaining)}</strong><small>تقريبي للصفحة</small></div>
            <div className="sup-kpi"><span className="sup-kpi-icon"><Wallet size={18} /></span><span>إجمالي المستحق</span><strong>{money(due)}</strong><small>قبل السداد</small></div>
          </>
        ) : (
          <>
            <div className="sup-kpi"><span className="sup-kpi-icon"><Wallet size={18} /></span><span>حالات بدون سداد</span><strong>{items.filter((item) => item.status === 'unpaid').length}</strong><small>في هذه الصفحة</small></div>
            <div className="sup-kpi"><span className="sup-kpi-icon"><Wallet size={18} /></span><span>الحالة</span><strong>متابعة</strong><small>المبالغ مخفية بصلاحية المالية</small></div>
          </>
        )}
      </div>

      <section className="sup-panel">
        <div className="sup-panel-head"><div><h2>قائمة المتأخرات</h2><span>{unpaidPage.meta.total}</span></div></div>
        {unpaidPage.loading && <p className="sup-muted">جارٍ التحميل…</p>}
        {!unpaidPage.loading && items.length === 0 && <p className="sup-muted">لا توجد متأخرات مستحقة الآن.</p>}
        <div className="sup-list">
          {items.map((item) => (
            <div className="sup-row" key={item.chargeId}>
              <span className="sup-kpi-icon"><Wallet size={16} /></span>
              <div className="sup-row-copy"><strong>{item.studentName}</strong><small>{item.circleName} · {item.teacherName} · {item.studentCode}</small></div>
              {showAmounts && item.balance !== null && <div className="sup-money"><strong>{money(item.balance)}</strong><small>من {money(item.amountDue)}</small></div>}
              <WhatsAppButton recipientType="student_guardian" recipientId={item.studentId} templateKey="unpaid" canCommunicate={canCommunicate} demo={demo} />
              <span className="t-badge t-badge-gold">{item.status === 'partial' ? 'جزئي' : 'متأخر'}</span>
            </div>
          ))}
        </div>
        <Pager
          page={unpaidPage.page}
          pageSize={unpaidPage.pageSize}
          total={unpaidPage.meta.total}
          onPageChange={unpaidPage.setPage}
          buttonClassName="t-secondary"
          label="متأخر"
        />
      </section>
    </div>
  )
}
