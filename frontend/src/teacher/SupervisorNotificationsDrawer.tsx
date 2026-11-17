import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, CheckCircle2, RefreshCw, X } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { AppNotification, NotificationsResponse } from './teacherTypes'
import { dateLabel } from './supervisorFormat'

type Props = {
  open: boolean
  canResolve: boolean
  unread: number
  onClose: () => void
  onUnreadChange: (value: number) => void
}

const categories = [
  { id: 'all', label: 'الكل' },
  { id: 'attendance', label: 'الحضور' },
  { id: 'payment', label: 'المدفوعات' },
  { id: 'schedule', label: 'الجدول' },
  { id: 'system', label: 'النظام' },
]

export default function SupervisorNotificationsDrawer({ open, canResolve, unread, onClose, onUnreadChange }: Props) {
  const [data, setData] = useState<NotificationsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('all')
  const [resolving, setResolving] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await teacherApi.notifications('all')
      setData(response)
      onUnreadChange(response.counts.unread)
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل التنبيهات.')
    } finally {
      setLoading(false)
    }
  }, [onUnreadChange])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const items = useMemo(() => (data?.notifications ?? []).filter((item) =>
    (category === 'all' || item.category === category) &&
    (status === 'all' || item.status === status)), [data, category, status])

  const markRead = async (item: AppNotification) => {
    if (item.readAt) return
    try {
      await teacherApi.read(item.id)
      setData((current) => current ? {
        ...current,
        counts: { ...current.counts, unread: Math.max(0, current.counts.unread - 1) },
        notifications: current.notifications.map((row) => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row),
      } : current)
      onUnreadChange(Math.max(0, unread - 1))
    } catch { /* the list can be refreshed */ }
  }

  const markAll = async () => {
    setBusy(true)
    try {
      await teacherApi.readAll()
      await load()
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحديد الكل كمقروء.')
    } finally {
      setBusy(false)
    }
  }

  const resolve = async (item: AppNotification) => {
    if (!note.trim()) return
    setBusy(true)
    try {
      await teacherApi.resolve(item.id, note.trim())
      setResolving(null)
      setNote('')
      await load()
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر إغلاق التنبيه.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="sup-drawer-backdrop" onClick={onClose}>
      <aside className="sup-drawer" onClick={(event) => event.stopPropagation()} aria-label="مركز التنبيهات">
        <header className="sup-drawer-head">
          <div><span className="sup-eyebrow">مركز التنبيهات</span><h2>التنبيهات <small>{unread} غير مقروء</small></h2></div>
          <div>
            <button className="sup-icon-button" onClick={() => void load()} disabled={loading} aria-label="تحديث"><RefreshCw size={17} /></button>
            <button className="sup-icon-button" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
          </div>
        </header>

        <div className="sup-drawer-filters">
          {categories.map((item) => <button key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>{item.label}</button>)}
        </div>
        <div className="sup-drawer-filters">
          {(['open', 'resolved', 'all'] as const).map((value) => (
            <button key={value} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>{value === 'open' ? 'مفتوح' : value === 'resolved' ? 'تم الحل' : 'الكل'}</button>
          ))}
          <button onClick={() => void markAll()} disabled={busy}>تحديد الكل كمقروء</button>
        </div>

        {error && <p className="t-error">{error}</p>}
        {loading && !data && <div className="t-empty">جارٍ تحميل التنبيهات…</div>}
        {!loading && items.length === 0 && <div className="t-empty">لا توجد تنبيهات في هذا التصنيف.</div>}

        <div className="sup-drawer-list">
          {items.map((item) => (
            <article key={item.id} className={`sup-notification ${item.readAt ? '' : 'unread'} ${item.status === 'resolved' ? 'resolved' : ''}`}>
              <div className="sup-notification-head">
                <strong>{item.title}</strong>
                <span className={item.status === 'resolved' ? 't-badge t-badge-ok' : 't-badge t-badge-gold'}>{item.status === 'resolved' ? 'تم الحل' : 'مفتوح'}</span>
              </div>
              <p>{item.body}</p>
              <small>{dateLabel(item.createdAt)} · {categories.find((row) => row.id === item.category)?.label ?? item.category}</small>
              {item.resolutionNote && <p className="t-note">الإغلاق: {item.resolutionNote}</p>}
              <div className="sup-notification-actions">
                {!item.readAt && <button className="sup-text-button" onClick={() => void markRead(item)}>تحديد كمقروء</button>}
                {canResolve && item.status === 'open' && item.category !== 'payment' && (
                  <button className="sup-text-button" onClick={() => setResolving(resolving === item.id ? null : item.id)}>إغلاق المشكلة</button>
                )}
              </div>
              {resolving === item.id && (
                <div className="sup-resolve">
                  <textarea className="t-textarea" rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="سبب الإغلاق أو نتيجة المتابعة" />
                  <div className="sup-resolve-actions">
                    <button className="t-primary" onClick={() => void resolve(item)} disabled={busy || !note.trim()}><CheckCircle2 size={15} /> حفظ الإغلاق</button>
                    <button className="t-secondary" onClick={() => setResolving(null)}>إلغاء</button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      </aside>
    </div>
  )
}
