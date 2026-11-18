import { useCallback, useEffect, useMemo, useState } from 'react'
import { BellRing, CheckCheck, CircleAlert, RefreshCw, ShieldAlert } from 'lucide-react'
import { api } from '../system/api'
import type { AdminNotification, AdminNotificationsResponse } from '../system/types'
import type { DarApplicationContext } from '../application/useDarApplication'

type Props = { ctx: DarApplicationContext }
type Filter = 'open' | 'resolved' | 'all'

const categoryLabels: Record<string, string> = {
  attendance: 'حضور',
  payment: 'اشتراك',
  request: 'طلب',
  session: 'حلقة',
  teacher: 'معلمة',
  student: 'طالبة',
  system: 'نظام',
}

function categoryLabel(category: string) {
  return categoryLabels[category] ?? category
}

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function severityLabel(severity: string) {
  if (severity === 'critical') return 'حرج'
  if (severity === 'warning') return 'تنبيه'
  return 'معلومة'
}

export default function NotificationsPage({ ctx }: Props) {
  const [data, setData] = useState<AdminNotificationsResponse | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [resolutionNote, setResolutionNote] = useState('')

  const load = useCallback(async (status: Filter) => {
    setLoading(true)
    setError(null)
    try {
      setData(await api<AdminNotificationsResponse>(`/api/admin/notifications?status=${status}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل الإشعارات.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(filter) }, [filter, load])

  const notifications = data?.notifications ?? []
  const openCount = data?.counts.open ?? 0
  const unreadCount = data?.counts.unread ?? 0
  const resolvedCount = data?.counts.resolved ?? 0

  const markRead = async (item: AdminNotification) => {
    if (item.readAt) return
    setBusyId(item.id)
    try {
      await api(`/api/admin/notifications/${item.id}/read`, { method: 'POST' })
      setData((current) => current ? {
        ...current,
        counts: { ...current.counts, unread: Math.max(0, current.counts.unread - 1) },
        notifications: current.notifications.map((row) => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row),
      } : current)
    } catch (err) {
      ctx.setToast({ tone: 'error', text: err instanceof Error ? err.message : 'تعذر تحديد الإشعار كمقروء.' })
    } finally {
      setBusyId(null)
    }
  }

  const markAllRead = async () => {
    setMarkingAll(true)
    try {
      await api('/api/admin/notifications/read-all', { method: 'POST' })
      setData((current) => current ? {
        ...current,
        counts: { ...current.counts, unread: 0 },
        notifications: current.notifications.map((row) => ({ ...row, readAt: row.readAt ?? new Date().toISOString() })),
      } : current)
      ctx.setToast({ tone: 'success', text: 'تم تحديد كل الإشعارات المفتوحة كمقروءة.' })
    } catch (err) {
      ctx.setToast({ tone: 'error', text: err instanceof Error ? err.message : 'تعذر تحديد الإشعارات كمقروءة.' })
    } finally {
      setMarkingAll(false)
    }
  }

  const resolve = async (item: AdminNotification) => {
    if (!resolutionNote.trim()) {
      ctx.setToast({ tone: 'error', text: 'اكتب سبب إغلاق التنبيه أولًا.' })
      return
    }
    setBusyId(item.id)
    try {
      await api(`/api/admin/notifications/${item.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ note: resolutionNote.trim() }),
      })
      setResolvingId(null)
      setResolutionNote('')
      await load(filter)
      ctx.setToast({ tone: 'success', text: 'تم إغلاق التنبيه.' })
    } catch (err) {
      ctx.setToast({ tone: 'error', text: err instanceof Error ? err.message : 'تعذر إغلاق التنبيه.' })
    } finally {
      setBusyId(null)
    }
  }

  const actionPage = useMemo(() => (item: AdminNotification) => {
    if (item.category === 'payment') return 'payments'
    if (item.category === 'attendance' || item.category === 'session') return 'schedule'
    return null
  }, [])

  return (
    <section className="admin-insights-page">
      <div className="page-toolbar">
        <div className="toolbar-copy">
          <h2>الإشعارات</h2>
          <p>تنبيهات الحضور والاشتراكات والطلبات الواردة من مساحة الإشراف وبوابة المعلمة. الإغلاق متاح للمشرفات والإدارة.</p>
        </div>
        <div className="toolbar-actions">
          <button className="secondary-button" onClick={() => void load(filter)} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : undefined} /> تحديث
          </button>
          <button className="secondary-button" onClick={() => void markAllRead()} disabled={markingAll || unreadCount === 0}>
            <CheckCheck size={15} /> {markingAll ? 'جارٍ التحديد…' : 'تحديد الكل كمقروء'}
          </button>
        </div>
      </div>

      <div className="admin-insight-stats">
        <div><span className="admin-insight-icon tone-teal"><BellRing size={17} /></span><div><small>مفتوحة</small><strong>{openCount}</strong></div></div>
        <div><span className="admin-insight-icon tone-gold"><CircleAlert size={17} /></span><div><small>غير مقروءة</small><strong>{unreadCount}</strong></div></div>
        <div><span className="admin-insight-icon tone-muted"><ShieldAlert size={17} /></span><div><small>مغلقة</small><strong>{resolvedCount}</strong></div></div>
      </div>

      <div className="admin-insight-toolbar">
        <div className="admin-insight-segment">
          {(['open', 'resolved', 'all'] as const).map((value) => (
            <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
              {value === 'open' ? 'المفتوحة' : value === 'resolved' ? 'المغلقة' : 'الكل'}
            </button>
          ))}
        </div>
        <span className="admin-insight-count">{notifications.length} إشعار</span>
      </div>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load(filter)}>إعادة المحاولة</button></div>}
      {loading && notifications.length === 0 && <div className="empty-inline">جارٍ تحميل الإشعارات…</div>}
      {!loading && notifications.length === 0 && <div className="empty-inline">لا توجد إشعارات في هذا التصنيف.</div>}

      <div className="admin-notification-list">
        {notifications.map((item) => {
          const unread = !item.readAt
          const target = actionPage(item)
          return (
            <article key={item.id} className={`admin-notification-card ${unread ? 'is-unread' : ''} ${item.status === 'resolved' ? 'is-resolved' : ''}`}>
              <div className="admin-notification-top">
                <span className={`admin-severity tone-${item.severity === 'critical' ? 'bad' : item.severity === 'warning' ? 'gold' : 'teal'}`}>{severityLabel(item.severity)}</span>
                <span className="admin-notification-category">{categoryLabel(item.category)}</span>
                {unread && <span className="admin-unread-dot" aria-label="غير مقروء" />}
                <time>{dateLabel(item.createdAt)}</time>
              </div>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              {item.resolutionNote && <small className="admin-notification-resolution">تم الإغلاق: {item.resolutionNote}</small>}
              <div className="admin-notification-actions">
                {unread && <button className="text-link" onClick={() => void markRead(item)} disabled={busyId === item.id}>تحديد كمقروء</button>}
                {target && <button className="text-link" onClick={() => ctx.changePage(target)}>فتح القسم</button>}
                {item.status === 'open' && item.category !== 'payment' && (
                  <button className="text-link" onClick={() => { setResolvingId(item.id); setResolutionNote('') }}>إغلاق التنبيه</button>
                )}
              </div>
              {resolvingId === item.id && (
                <div className="admin-resolve-box">
                  <textarea rows={2} maxLength={1000} value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder="اكتب سبب الإغلاق أو الإجراء الذي تم." />
                  <div>
                    <button className="primary-button compact-button" onClick={() => void resolve(item)} disabled={busyId === item.id}>{busyId === item.id ? 'جارٍ الإغلاق…' : 'تأكيد الإغلاق'}</button>
                    <button className="secondary-button compact-button" onClick={() => { setResolvingId(null); setResolutionNote('') }}>إلغاء</button>
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
