import { useCallback, useMemo, useRef, useState } from 'react'
import { Bell, CheckCircle2, RefreshCw } from 'lucide-react'
import { teacherApi } from './teacherApi'
import type { AppNotification } from './teacherTypes'
import Pager from '../components/common/Pager'
import { usePagedResource } from '../hooks/usePagedResource'

type Props = {
  loading: boolean
  error: string | null
  canResolve: boolean
  busy: boolean
  onRefresh: () => void
  onRead: (id: string) => void
  onReadAll: () => void
  onResolve: (id: string, note: string) => Promise<void>
  onAction: (url: string) => void
  onUnreadChange?: (unread: number) => void
}

const categories = [
  { id: 'all', label: 'الكل' },
  { id: 'attendance', label: 'الحضور' },
  { id: 'payment', label: 'المدفوعات' },
  { id: 'schedule', label: 'الجدول' },
  { id: 'system', label: 'النظام' },
]

export default function TeacherNotifications({ loading, error, canResolve, busy, onRefresh, onRead, onReadAll, onResolve, onAction, onUnreadChange }: Props) {
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('all')
  const [resolving, setResolving] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const unreadChange = useRef(onUnreadChange)
  unreadChange.current = onUnreadChange

  const fetchNotifications = useCallback(async (page: number, pageSize: number) => {
    const response = await teacherApi.notificationsPage({ status, page, pageSize })
    unreadChange.current?.(response.data.counts.unread)
    return { items: response.data.notifications, meta: response.meta }
  }, [status])
  const notificationsPage = usePagedResource<AppNotification>({ fetcher: fetchNotifications, deps: [status] })

  const items = useMemo(
    () => notificationsPage.items.filter((item) => category === 'all' || item.category === category),
    [notificationsPage.items, category],
  )

  const refresh = () => { notificationsPage.reload(); onRefresh() }

  const resolve = async (item: AppNotification) => {
    if (!note.trim()) return
    try {
      await onResolve(item.id, note.trim())
      setResolving(null)
      setNote('')
      refresh()
    } catch { /* the parent shows the error */ }
  }

  const displayLoading = loading || notificationsPage.loading
  const displayError = error ?? notificationsPage.error

  return (
    <div className="t-page">
      <header className="t-subheader">
        <span className="t-icon-button"><Bell size={20} /></span>
        <div><span className="t-eyebrow">مركز التنبيهات</span><h1>التنبيهات</h1></div>
        <button className="t-icon-button" aria-label="تحديث" onClick={refresh} disabled={displayLoading}><RefreshCw size={18} /></button>
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
        <button className="t-filter" onClick={() => { onReadAll(); refresh() }} disabled={busy}>تحديد الكل كمقروء</button>
      </div>

      {displayLoading && notificationsPage.items.length === 0 && <div className="t-empty">جارٍ تحميل التنبيهات…</div>}
      {displayError && <p className="t-error">{displayError}</p>}
      {items.length === 0 && !displayLoading && <div className="t-empty">لا توجد تنبيهات في هذا التصنيف.</div>}

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
              {!item.readAt && <button className="t-text-button" onClick={() => { onRead(item.id); refresh() }}>تحديد كمقروء</button>}
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

      <Pager
        page={notificationsPage.page}
        pageSize={notificationsPage.pageSize}
        total={notificationsPage.meta.total}
        onPageChange={notificationsPage.setPage}
        buttonClassName="t-secondary"
        label="تنبيه"
      />

      <p className="t-footnote">التنبيهات تبقى مفتوحة حتى تُحل المشكلة نفسها — مجرد القراءة لا تغلقها. تنبيه الاشتراك يُغلق تلقائيًا عند سداد المبلغ بالكامل.</p>
    </div>
  )
}
