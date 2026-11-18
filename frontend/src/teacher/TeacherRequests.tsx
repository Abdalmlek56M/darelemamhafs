import { formatTime12 } from '../lib/dates'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CalendarPlus, RefreshCw, XCircle } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { AttendanceRequest, TodayResponse } from './teacherTypes'
import { dateLabel } from './supervisorFormat'

type Props = { today: TodayResponse | null }
type RequestType = 'absence' | 'cancellation' | 'correction'

export default function TeacherRequests({ today }: Props) {
  const [requests, setRequests] = useState<AttendanceRequest[]>([])
  const [type, setType] = useState<RequestType>('absence')
  const [slotId, setSlotId] = useState('')
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState('60')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRequests((await teacherApi.teacherRequests()).requests)
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل الطلبات.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const slots = today?.slots ?? []
  const needsAttendance = type === 'correction'
  const choices = needsAttendance ? slots.filter((slot) => slot.attendanceId) : slots

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!slotId) { setError('اختر الحلقة أولًا.'); return }
    if (reason.trim().length < 3) { setError('اكتب سببًا واضحًا.'); return }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      if (type === 'correction') {
        const slot = slots.find((item) => item.id === slotId)
        if (!slot?.attendanceId) throw new Error('هذه الحلقة لا تحتوي على سجل حضور للتصحيح.')
        await teacherApi.createTeacherRequest({
          type, attendanceId: slot.attendanceId, reason: reason.trim(),
          proposedDurationMinutes: Number(duration), proposedNote: reason.trim(),
        })
      } else {
        await teacherApi.createTeacherRequest({
          type, scheduleSlotId: slotId, date: today?.date, reason: reason.trim(),
        })
      }
      setReason('')
      setNotice('تم إرسال الطلب إلى المشرفة.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال الطلب.')
    } finally {
      setSaving(false)
    }
  }

  const cancel = async (id: string) => {
    try {
      await teacherApi.cancelTeacherRequest(id)
      await load()
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر إلغاء الطلب.')
    }
  }

  return (
    <div className="t-page">
      <header className="t-subheader">
        <span className="t-icon-button"><CalendarPlus size={20} /></span>
        <div><span className="t-eyebrow">طلبات الحضور</span><h1>طلباتي</h1></div>
        <button className="t-icon-button" aria-label="تحديث" onClick={() => void load()} disabled={loading}><RefreshCw size={18} /></button>
      </header>

      <form className="t-note-form" onSubmit={submit}>
        <label className="t-label" htmlFor="request-type">نوع الطلب</label>
        <select id="request-type" className="t-input" value={type} onChange={(event) => { setType(event.target.value as RequestType); setSlotId('') }}>
          <option value="absence">غياب</option>
          <option value="cancellation">إلغاء حلقة</option>
          <option value="correction">تصحيح حضور</option>
        </select>

        <label className="t-label" htmlFor="request-slot">الحلقة</label>
        <select id="request-slot" className="t-input" value={slotId} onChange={(event) => setSlotId(event.target.value)} required>
          <option value="">اختر الحلقة</option>
          {choices.map((slot) => (
            <option key={slot.id} value={slot.id}>{slot.circleName} · {formatTime12(slot.startsAt)}{type === 'correction' ? ' · مسجلة' : ''}</option>
          ))}
        </select>
        {choices.length === 0 && <p className="t-hint">لا توجد حلقات مناسبة اليوم لهذا النوع. التصحيح يحتاج حلقة مسجلة.</p>}

        {type === 'correction' && (
          <>
            <label className="t-label" htmlFor="request-duration">المدة الصحيحة (دقيقة)</label>
            <input id="request-duration" className="t-input" type="number" min={1} max={360} value={duration} onChange={(event) => setDuration(event.target.value)} />
          </>
        )}

        <label className="t-label" htmlFor="request-reason">السبب</label>
        <textarea id="request-reason" className="t-textarea" rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="اكتب سبب الطلب بوضوح…" required />

        {error && <p className="t-error">{error}</p>}
        {notice && <p className="t-hint">{notice}</p>}
        <button className="t-primary" type="submit" disabled={saving || !choices.length}>{saving ? 'جارٍ الإرسال…' : 'إرسال الطلب'}</button>
      </form>

      <div className="t-section-title"><strong>طلباتي السابقة</strong><span>{requests.length}</span></div>
      <div className="t-list">
        {loading && requests.length === 0 && <div className="t-empty">جارٍ تحميل الطلبات…</div>}
        {!loading && requests.length === 0 && <div className="t-empty">لا توجد طلبات بعد.</div>}
        {requests.map((request) => (
          <article className="t-row" key={request.id}>
            <div className="t-row-copy">
              <strong>{request.type === 'absence' ? 'غياب' : request.type === 'cancellation' ? 'إلغاء حلقة' : 'تصحيح حضور'} · {request.circleName}</strong>
              <small>{request.date ? dateLabel(request.date) : dateLabel(request.createdAt)} · {request.reason}</small>
              {request.reviewNote && <small>ملاحظة المراجعة: {request.reviewNote}</small>}
            </div>
            <div className="t-row-actions">
              <span className={`t-badge ${request.status === 'approved' ? 't-badge-ok' : request.status === 'rejected' ? 't-badge-bad' : request.status === 'cancelled' ? 't-badge-muted' : 't-badge-gold'}`}>
                {request.status === 'approved' ? 'معتمد' : request.status === 'rejected' ? 'مرفوض' : request.status === 'cancelled' ? 'ملغي' : 'قيد المراجعة'}
              </span>
              {request.status === 'pending' && <button className="t-text-button" onClick={() => void cancel(request.id)}><XCircle size={13} /> إلغاء</button>}
            </div>
          </article>
        ))}
      </div>

      <p className="t-footnote">الطلبات تراجعها المشرفة. التصحيح يحتاج موافقة قبل تطبيقه.</p>
    </div>
  )
}
