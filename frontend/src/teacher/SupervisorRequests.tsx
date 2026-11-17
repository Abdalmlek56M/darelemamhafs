import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { SupervisorAttendanceRequest } from './teacherTypes'
import { dateLabel } from './supervisorFormat'
import { demoRequests } from './supervisorDemo'

type Props = { demo: boolean }
type Status = 'pending' | 'all'

export default function SupervisorRequests({ demo }: Props) {
  const [requests, setRequests] = useState<SupervisorAttendanceRequest[]>([])
  const [status, setStatus] = useState<Status>('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (filter: Status) => {
    if (demo) {
      setRequests(filter === 'pending' ? demoRequests.filter((item) => item.status === 'pending') : demoRequests)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setRequests((await teacherApi.supervisorRequests(filter)).requests)
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل الطلبات.')
    } finally {
      setLoading(false)
    }
  }, [demo])

  useEffect(() => { void load(status) }, [status, load])

  const review = async (request: SupervisorAttendanceRequest, approve: boolean) => {
    if (demo) { setError('الوضع التجريبي للعرض فقط — المراجعة معطلة.'); return }
    setBusy(request.id)
    setError(null)
    try {
      await teacherApi.reviewRequest(request.id, approve, approve ? 'تمت المراجعة والاعتماد.' : 'تم رفض الطلب.')
      await load(status)
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر مراجعة الطلب.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="sup-page">
      <div className="sup-page-head">
        <div><span className="sup-eyebrow">متابعة الطلبات</span><h1>طلبات المعلمات</h1><p>طلبات الغياب والإلغاء وتصحيح الحضور، مع الاعتماد أو الرفض.</p></div>
        <button className="sup-icon-button" onClick={() => void load(status)} disabled={loading} aria-label="تحديث"><RefreshCw size={18} /></button>
      </div>

      <div className="sup-segment">
        <button className={status === 'pending' ? 'active' : ''} onClick={() => setStatus('pending')}>قيد المراجعة ({demo ? demoRequests.filter((item) => item.status === 'pending').length : requests.length})</button>
        <button className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}>الكل</button>
      </div>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load(status)}>إعادة المحاولة</button></div>}
      {loading && requests.length === 0 && <div className="t-empty">جارٍ تحميل الطلبات…</div>}
      {!loading && requests.length === 0 && <div className="t-empty">لا توجد طلبات في هذا التصنيف.</div>}

      <div className="sup-list">
        {requests.map((request) => (
          <article className="sup-panel" key={request.id}>
            <div className="sup-panel-head">
              <div><h2>{request.type === 'absence' ? 'طلب غياب' : request.type === 'cancellation' ? 'طلب إلغاء حلقة' : 'طلب تصحيح حضور'}</h2><span>{dateLabel(request.date ?? request.createdAt)}</span></div>
              <span className={`t-badge ${request.status === 'approved' ? 't-badge-ok' : request.status === 'rejected' ? 't-badge-bad' : request.status === 'cancelled' ? 't-badge-muted' : 't-badge-gold'}`}>
                {request.status === 'approved' ? 'معتمد' : request.status === 'rejected' ? 'مرفوض' : request.status === 'cancelled' ? 'ملغي' : 'قيد المراجعة'}
              </span>
            </div>
            <p className="sup-muted">{request.teacherName} · {request.circleName}</p>
            <p className="sup-request-reason">{request.reason}</p>
            {request.reviewNote && <p className="sup-muted">ملاحظة المراجعة: {request.reviewNote}</p>}
            {request.status === 'pending' && (
              <div className="sup-request-actions">
                <button className="sup-primary" disabled={busy === request.id} onClick={() => void review(request, true)}><CheckCircle2 size={15} /> اعتماد</button>
                <button className="sup-danger" disabled={busy === request.id} onClick={() => void review(request, false)}><XCircle size={15} /> رفض</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}
