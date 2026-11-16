import { useMemo, useState } from 'react'
import { Bell, CheckCircle2, RefreshCw } from 'lucide-react'
import type { AppNotification, NotificationsResponse } from './teacherTypes'

type Props = {
  data: NotificationsResponse | null
  loading: boolean
  error: string | null
  canResolve: boolean
  busy: boolean
  onRefresh: () => void
  onRead: (id: string) => void
  onReadAll: () => void
  onResolve: (id: string, note: string) => Promise<void>
  onAction: (url: string) => void
}

const categories = [
  { id: 'all', label: 'الكل' },
  { id: 'attendance', label: 'الحضور' },
  { id: 'payment', label: 'المدفوعات' },
  { id: 'schedule', label: 'الجدول' },
  { id: 'system', label: 'النظام' },
]

export default function TeacherNotifications({ data, loading, error, canResolve, busy, onRefresh, onRead, onReadAll, onResolve, onAction }: Props) {
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('all')
  const [resolving, setResolving] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const items = useMemo(() => {
    return (data?.notifications ?? []).filter((item) =>
      (category === 'all' || item.category === category) &&
      (status === 'all' || item.status === status))
  }, [data, category, status])

  const resolve = async (item: AppNotification) => {
    if (!note.trim()) return
    try {
      await onResolve(item.id, note.trim())
      setResolving(null)
      setNote('')
    } catch { /* the parent shows the error */ }
  }

  return (
    <div className="t-page">
      <header className="t-subheader">
        <span className="t-icon-button"><Bell size={20} /></span>
        <div><span className="t-eyebrow">مركز التنبيهات</span><h1>التنبيهات</h1></div>
        <button className="t-icon-button" aria-label="تحديث" onClick={onRefresh} disabled={loading}><RefreshCw size={18} /></button>
      </header>

      <div className="t-filter-row">
        {categories.map((item) => (
          <button key={item.id} className={`t-filter ${category === item.id ? 'active' : ''}`} onClick={() => setCategory(item.id)}>{item.label}</button>
        ))}
      </div>
      <div className="t-filter-row">
        {(['open', 'resolved', 'all'] as const).map((value) => (
          <button key={value} className={`t-filter ${status === value ? 'active' : ''}`} onClick={() => setStatus(value)}>
            {value === 'open' ? 'مفتوح' : value === 'resolved' ? 'تم الحل' : 'الكل'}
          </button>
        ))}
        <button className="t-filter" onClick={onReadAll} disabled={busy}>تحديد الكل كمقروء</button>
      </div>

      {loading && !data && <div className="t-empty">جارٍ تحميل التنبيهات…</div>}
      {error && <p className="t-error">{error}</p>}
      {items.length === 0 && !loading && <div className="t-empty">لا توجد تنبيهات في هذا التصنيف.</div>}

      <div className="t-notifications">
        {items.map((item) => (
          <article key={item.id} className={`t-notification ${item.readAt ? '' : 'unread'} ${item.status === 'resolved' ? 'resolved' : ''}`}>
            <div className="t-notification-head">
              <strong>{item.title}</strong>
              <span className={`t-badge ${item.status === 'resolved' ? 't-badge-ok' : 't-badge-gold'}`}>{item.status === 'resolved' ? 'تم الحل' : 'مفتوح'}</span>
            </div>
            <p>{item.body}</p>
            {item.resolutionNote && <p className="t-note">الإغلاق: {item.resolutionNote}</p>}
            <div className="t-notification-actions">
              {item.actionUrl && <button className="t-text-button" onClick={() => { onRead(item.id); onAction(item.actionUrl!) }}>فتح</button>}
              {!item.readAt && <button className="t-text-button" onClick={() => onRead(item.id)}>تحديد كمقروء</button>}
              {canResolve && item.status === 'open' && item.category !== 'payment' && (
                <button className="t-text-button" onClick={() => setResolving(resolving === item.id ? null : item.id)}>إغلاق المشكلة</button>
              )}
            </div>
            {resolving === item.id && (
              <div className="t-resolve">
                <textarea className="t-textarea" rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="اكتب سبب الإغلاق أو نتيجة المتابعة" />
                <div className="t-sheet-actions">
                  <button className="t-primary" onClick={() => void resolve(item)} disabled={busy || !note.trim()}><CheckCircle2 size={16} /> حفظ الإغلاق</button>
                  <button className="t-secondary" onClick={() => setResolving(null)}>إلغاء</button>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>

      <p className="t-footnote">التنبيهات تبقى مفتوحة حتى تُحل المشكلة نفسها — مجرد القراءة لا تغلقها. تنبيه الاشتراك يُغلق تلقائيًا عند سداد المبلغ بالكامل.</p>
    </div>
  )
}
