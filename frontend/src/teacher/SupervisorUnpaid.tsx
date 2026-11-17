import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Wallet } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { SupervisorUnpaidResponse } from './teacherTypes'
import { money } from './teacherFormat'
import { demoUnpaid } from './supervisorDemo'

type Props = { demo: boolean }

export default function SupervisorUnpaid({ demo }: Props) {
  const [data, setData] = useState<SupervisorUnpaidResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (demo) { setData(demoUnpaid); setLoading(false); setError(null); return }
    setLoading(true)
    setError(null)
    try {
      setData(await teacherApi.supervisorUnpaid())
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل المتأخرات.')
    } finally {
      setLoading(false)
    }
  }, [demo])

  useEffect(() => { void load() }, [load])

  return (
    <div className="sup-page">
      <div className="sup-page-head">
        <div><span className="sup-eyebrow">متابعة الاشتراكات</span><h1>المتأخرات</h1><p>طلبات مفتوحة حتى يتم السداد بالكامل. لا تعرض إيصالات أو حركات مالية.</p></div>
        <button className="sup-icon-button" onClick={() => void load()} disabled={loading} aria-label="تحديث"><RefreshCw size={18} /></button>
      </div>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load()}>إعادة المحاولة</button></div>}

      <div className="sup-kpi-grid sup-kpi-grid-three">
        <div className="sup-kpi"><span className="sup-kpi-icon is-warn"><Wallet size={18} /></span><span>عدد المتأخرات</span><strong>{data?.count ?? 0}</strong><small>{data?.month ?? ''}</small></div>
        <div className="sup-kpi"><span className="sup-kpi-icon"><Wallet size={18} /></span><span>إجمالي المتبقي</span><strong>{money((data?.unpaid ?? []).reduce((sum, item) => sum + item.balance, 0))}</strong><small>تقريبي</small></div>
        <div className="sup-kpi"><span className="sup-kpi-icon"><Wallet size={18} /></span><span>إجمالي المستحق</span><strong>{money((data?.unpaid ?? []).reduce((sum, item) => sum + item.amountDue, 0))}</strong><small>قبل السداد</small></div>
      </div>

      <section className="sup-panel">
        <div className="sup-panel-head"><div><h2>قائمة المتأخرات</h2><span>{data?.count ?? 0}</span></div></div>
        {loading && <p className="sup-muted">جارٍ التحميل…</p>}
        {!loading && (data?.unpaid.length ?? 0) === 0 && <p className="sup-muted">لا توجد متأخرات مستحقة الآن.</p>}
        <div className="sup-list">
          {data?.unpaid.map((item) => (
            <div className="sup-row" key={item.chargeId}>
              <span className="sup-kpi-icon"><Wallet size={16} /></span>
              <div className="sup-row-copy"><strong>{item.studentName}</strong><small>{item.circleName} · {item.teacherName} · {item.studentCode}</small></div>
              <div className="sup-money"><strong>{money(item.balance)}</strong><small>من {money(item.amountDue)}</small></div>
              <span className="t-badge t-badge-gold">مفتوح</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
