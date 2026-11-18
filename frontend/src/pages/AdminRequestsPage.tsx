import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ClipboardCheck, RefreshCw, XCircle } from 'lucide-react'
import { api } from '../system/api'
import type { AdminAttendanceRequest, AdminRequestsResponse } from '../system/types'
import type { DarApplicationContext } from '../application/useDarApplication'

type Props = { ctx: DarApplicationContext }
type Filter = 'pending' | 'approved' | 'rejected' | 'all'

const typeLabels: Record<string, string> = {
  absence: 'غياب',
  cancellation: 'إلغاء حصة',
  correction: 'تصحيح حضور',
}

const statusLabels: Record<string, string> = {
  pending: 'قيد المراجعة',
  approved: 'معتمد',
  rejected: 'مرفوض',
  cancelled: 'ملغي',
}

function dateLabel(value: string | null) {
  if (!value) return '—'
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(date)
}

function createdLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default function AdminRequestsPage({ ctx }: Props) {
  const [data, setData] = useState<AdminRequestsResponse | null>(null)
  const [filter, setFilter] = useState<Filter>('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<AdminAttendanceRequest | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (status: Filter) => {
    setLoading(true)
    setError(null)
    try {
      setData(await api<AdminRequestsResponse>(`/api/admin/requests?status=${status}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل طلبات المعلمات.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(filter) }, [filter, load])

  const review = async (approve: boolean) => {
    if (!reviewing) return
    if (!approve && !note.trim()) {
      ctx.setToast({ tone: 'error', text: 'اكتب سبب الرفض أولًا.' })
      return
    }
    setBusy(true)
    try {
      await api(`/api/admin/requests/${reviewing.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ approve, note: note.trim() || null }),
      })
      setReviewing(null)
      setNote('')
      await load(filter)
      ctx.setToast({ tone: 'success', text: approve ? 'تم اعتماد الطلب وتطبيق أثره.' : 'تم رفض الطلب.' })
    } catch (err) {
      ctx.setToast({ tone: 'error', text: err instanceof Error ? err.message : 'تعذر مراجعة الطلب.' })
    } finally {
      setBusy(false)
    }
  }

  const requests = data?.requests ?? []

  return (
    <section className="admin-insights-page">
      <div className="page-toolbar">
        <div className="toolbar-copy">
          <h2>طلبات المعلمات</h2>
          <p>طلبات الغياب والإلغاء وتصحيح الحضور. اعتماد الطلب يطبّق أثره على حضور المعلمة والأجر مع تسجيل العملية في سجل التدقيق.</p>
        </div>
        <div className="toolbar-actions">
          <button className="secondary-button" onClick={() => void load(filter)} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : undefined} /> تحديث</button>
        </div>
      </div>

      <div className="admin-insight-toolbar">
        <div className="admin-insight-segment">
          {(['pending', 'approved', 'rejected', 'all'] as const).map((value) => (
            <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
              {value === 'pending' ? 'قيد المراجعة' : value === 'approved' ? 'المعتمدة' : value === 'rejected' ? 'المرفوضة' : 'الكل'}
            </button>
          ))}
        </div>
        <span className="admin-insight-count">{requests.length} طلب</span>
      </div>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load(filter)}>إعادة المحاولة</button></div>}
      {loading && requests.length === 0 && <div className="empty-inline">جارٍ تحميل الطلبات…</div>}
      {!loading && requests.length === 0 && <div className="empty-inline">لا توجد طلبات في هذا التصنيف.</div>}

      <div className="admin-notification-list">
        {requests.map((item) => (
          <article key={item.id} className={`admin-notification-card admin-request-card status-${item.status}`}>
            <div className="admin-notification-top">
              <span className={`admin-severity tone-${item.status === 'pending' ? 'gold' : item.status === 'approved' ? 'teal' : 'bad'}`}>{statusLabels[item.status] ?? item.status}</span>
              <span className="admin-notification-category">{typeLabels[item.type] ?? item.type}</span>
              <time>{createdLabel(item.createdAt)}</time>
            </div>
            <h3>{item.teacherName} · {item.circleName}</h3>
            <p>{item.reason}</p>
            <div className="admin-request-meta">
              <span>تاريخ الحصة: {dateLabel(item.date)}</span>
              {item.type === 'correction' && item.payload && <CorrectionPayload payload={item.payload} />}
              {item.reviewedAt && <span>تمت المراجعة: {createdLabel(item.reviewedAt)}</span>}
              {item.reviewNote && <span>ملاحظة المراجعة: {item.reviewNote}</span>}
            </div>
            {item.status === 'pending' && (
              <div className="admin-notification-actions">
                <button className="text-link" onClick={() => { setReviewing(item); setNote('') }}>مراجعة الطلب</button>
              </div>
            )}
            {reviewing?.id === item.id && (
              <div className="admin-resolve-box">
                <textarea rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="ملاحظة المراجعة (مطلوبة عند الرفض)." />
                <div>
                  <button className="primary-button compact-button" onClick={() => void review(true)} disabled={busy}><CheckCircle2 size={14} /> {busy ? 'جارٍ التنفيذ…' : 'اعتماد الطلب'}</button>
                  <button className="danger-button compact-button" onClick={() => void review(false)} disabled={busy}><XCircle size={14} /> رفض الطلب</button>
                  <button className="secondary-button compact-button" onClick={() => { setReviewing(null); setNote('') }} disabled={busy}>إلغاء</button>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="admin-request-note"><ClipboardCheck size={15} /><span>لا يتم تعديل أي سجل حضور قبل ضغط «اعتماد الطلب». رفض الطلب لا يغيّر الحضور.</span></div>
    </section>
  )
}

function CorrectionPayload({ payload }: { payload: string }) {
  try {
    const value = JSON.parse(payload) as { durationMinutes?: number; note?: string }
    return <span>المدة المقترحة: {value.durationMinutes ?? '—'} دقيقة{value.note ? ` · ${value.note}` : ''}</span>
  } catch {
    return null
  }
}
