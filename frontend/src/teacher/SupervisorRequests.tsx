import { useCallback, useState } from 'react'
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { SupervisorAttendanceRequest } from './teacherTypes'
import { dateLabel } from './supervisorFormat'
import { demoRequests } from './supervisorDemo'
import Pager from '../components/common/Pager'
import { usePagedResource } from '../hooks/usePagedResource'
import { defaultMeta } from '../lib/pagination'

type Props = { demo: boolean; onReviewed?: () => void }
type Status = 'pending' | 'all'

export default function SupervisorRequests({ demo, onReviewed }: Props) {
  const [status, setStatus] = useState<Status>('pending')
  const [appliedStatus, setAppliedStatus] = useState<Status>('pending')
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Kept apart from the paged list so switching to "الكل" never replaces a real
  // pending count with a placeholder.
  const [pendingTotal, setPendingTotal] = useState<number | null>(null)

  const fetchRequests = useCallback(async (page: number, pageSize: number) => {
    if (demo) {
      const rows = appliedStatus === 'pending'
        ? demoRequests.filter((item) => item.status === 'pending')
        : demoRequests
      const meta = defaultMeta(rows.length, 1, pageSize)
      if (appliedStatus === 'pending') setPendingTotal(meta.total)
      return { items: rows, meta }
    }
    const response = await teacherApi.supervisorRequestsPage({ status: appliedStatus, page, pageSize })
    if (appliedStatus === 'pending') setPendingTotal(response.meta.total)
    return { items: response.data.requests, meta: response.meta }
  }, [demo, appliedStatus])
  const requestsPage = usePagedResource<SupervisorAttendanceRequest>({ fetcher: fetchRequests, deps: [demo, appliedStatus] })
  const requests = requestsPage.items
  const error = actionError ?? requestsPage.error

  const changeStatus = (next: Status) => {
    setStatus(next)
    setAppliedStatus(next)
  }

  const review = async (request: SupervisorAttendanceRequest, approve: boolean) => {
    if (demo) { setActionError('الوضع التجريبي للعرض فقط — المراجعة معطلة.'); return }
    setBusy(request.id)
    setActionError(null)
    try {
      await teacherApi.reviewRequest(request.id, approve, approve ? 'تمت المراجعة والاعتماد.' : 'تم رفض الطلب.')
      requestsPage.reload()
      onReviewed?.()
    } catch (err) {
      setActionError(err instanceof TeacherApiError ? err.message : 'تعذر مراجعة الطلب.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="sup-page">
      <div className="sup-page-head">
        <div><span className="sup-eyebrow">متابعة الطلبات</span><h1>طلبات المعلمات</h1><p>طلبات الغياب والإلغاء وتصحيح الحضور، مع الاعتماد أو الرفض.</p></div>
        <button className="sup-icon-button" onClick={requestsPage.reload} disabled={requestsPage.loading} aria-label="تحديث"><RefreshCw size={18} /></button>
      </div>

      <div className="sup-segment">
        <button className={status === 'pending' ? 'active' : ''} onClick={() => changeStatus('pending')}>قيد المراجعة{pendingTotal === null ? '' : ` (${pendingTotal})`}</button>
        <button className={status === 'all' ? 'active' : ''} onClick={() => changeStatus('all')}>الكل</button>
      </div>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={requestsPage.reload}>إعادة المحاولة</button></div>}
      {requestsPage.loading && requests.length === 0 && <div className="t-empty">جارٍ تحميل الطلبات…</div>}
      {!requestsPage.loading && requests.length === 0 && <div className="t-empty">لا توجد طلبات في هذا التصنيف.</div>}

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

      <Pager
        page={requestsPage.page}
        pageSize={requestsPage.pageSize}
        total={requestsPage.meta.total}
        onPageChange={requestsPage.setPage}
        buttonClassName="t-secondary"
        label="طلب"
      />
    </div>
  )
}
