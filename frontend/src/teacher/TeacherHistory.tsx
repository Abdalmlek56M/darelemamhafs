import { useCallback, useState } from 'react'
import { ArrowRight, Clock3, History, LogIn, RefreshCw, Users } from 'lucide-react'
import { teacherApi } from './teacherApi'
import type { TeacherHistoryAttendance, TeacherHistoryLogin, TeacherHistorySession } from './teacherCalendarTypes'
import { minutesLabel, money } from './teacherFormat'
import { formatDate } from '../lib/formatters'
import Pager from '../components/common/Pager'
import { usePagedResource } from '../hooks/usePagedResource'

type Props = { onBack: () => void }

const statusLabels: Record<string, string> = {
  in_progress: 'جارية',
  awaiting_attendance: 'بانتظار الحضور',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  present: 'حاضرة',
  absent: 'غائبة',
  excused: 'بعذر',
}

function dateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' }).format(date)
}

function deviceLabel(userAgent: string | null) {
  if (!userAgent) return 'جهاز غير معروف'
  if (/iphone|ipad|android|mobile/i.test(userAgent)) return 'هاتف / تابلت'
  if (/windows/i.test(userAgent)) return 'Windows'
  if (/macintosh|mac os/i.test(userAgent)) return 'macOS'
  if (/linux/i.test(userAgent)) return 'Linux'
  return 'متصفح'
}

export default function TeacherHistory({ onBack }: Props) {
  const [logins, setLogins] = useState<TeacherHistoryLogin[]>([])

  const fetchSessions = useCallback(async (page: number, pageSize: number) => {
    const response = await teacherApi.teacherHistoryPage({ page, pageSize })
    setLogins(response.data.logins)
    return {
      items: response.data.sessions,
      meta: { ...response.meta, total: response.data.sessionTotal ?? response.meta.total },
    }
  }, [])

  const fetchAttendance = useCallback(async (page: number, pageSize: number) => {
    const response = await teacherApi.teacherHistoryPage({ page, pageSize })
    return {
      items: response.data.attendance,
      meta: { ...response.meta, total: response.data.attendanceTotal ?? response.meta.total },
    }
  }, [])

  const sessionsPage = usePagedResource<TeacherHistorySession>({ fetcher: fetchSessions, deps: [] })
  const attendancePage = usePagedResource<TeacherHistoryAttendance>({ fetcher: fetchAttendance, deps: [] })
  const loading = sessionsPage.loading || attendancePage.loading
  const error = sessionsPage.error ?? attendancePage.error
  const reload = () => { sessionsPage.reload(); attendancePage.reload() }

  return (
    <div className="t-page">
      <header className="t-subheader">
        <button className="t-icon-button" aria-label="رجوع" onClick={onBack}><ArrowRight size={20} /></button>
        <div><span className="t-eyebrow">أرشيفك</span><h1>سجلي</h1></div>
        <button className="t-icon-button" aria-label="تحديث" onClick={reload} disabled={loading}><RefreshCw className={loading ? 'spin' : undefined} size={18} /></button>
      </header>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={reload}>إعادة المحاولة</button></div>}
      {loading && sessionsPage.items.length === 0 && <div className="t-empty">جارٍ تحميل السجل…</div>}

      <section className="t-history-section">
        <div className="t-section-title"><strong><History size={15} /> سجل الحصص</strong><span>{sessionsPage.meta.total} حصة</span></div>
        {!loading && sessionsPage.items.length === 0 && <div className="t-empty">لا توجد حصص سابقة.</div>}
        <div className="t-history-list">
          {sessionsPage.items.map((session) => (
            <article className="t-history-card" key={session.id}>
              <div className="t-history-card-head">
                <strong>{session.circleName}</strong>
                <span className={`t-badge ${session.status === 'completed' ? 't-badge-ok' : session.status === 'cancelled' ? 't-badge-bad' : ''}`}>{statusLabels[session.status] ?? session.status}</span>
                <time>{formatDate(session.date)}</time>
              </div>
              <div className="t-history-meta">
                <span><Clock3 size={12} /> {dateTime(session.startedAt)} — {session.endedAt ? dateTime(session.endedAt) : 'لم تُنهَ'}</span>
                <span><Users size={12} /> {session.presentStudents} / {session.totalStudents} طالبة</span>
              </div>
              <div className="t-history-meta">
                <span>المجدولة: {minutesLabel(session.scheduledMinutes)}</span>
                <span>الفعلي: {session.actualMinutes == null ? '—' : minutesLabel(session.actualMinutes)}</span>
                <span>المحتسب: {session.payableMinutes == null ? '—' : minutesLabel(session.payableMinutes)}</span>
              </div>
              {session.note && <p className="t-history-note">{session.note}</p>}
            </article>
          ))}
        </div>
        <Pager page={sessionsPage.page} pageSize={sessionsPage.pageSize} total={sessionsPage.meta.total} onPageChange={sessionsPage.setPage} buttonClassName="t-secondary" label="حصة" />
      </section>

      <section className="t-history-section">
        <div className="t-section-title"><strong>سجل الحضور المسجل</strong><span>{attendancePage.meta.total} سجل</span></div>
        {!loading && attendancePage.items.length === 0 && <div className="t-empty">لا توجد سجلات حضور سابقة.</div>}
        <div className="t-history-list">
          {attendancePage.items.map((row) => (
            <article className="t-history-card" key={row.id}>
              <div className="t-history-card-head">
                <strong>{row.circleName}</strong>
                <span className={`t-badge ${row.status === 'present' ? 't-badge-ok' : row.status === 'absent' ? 't-badge-bad' : ''}`}>{statusLabels[row.status] ?? row.status}</span>
                <time>{formatDate(row.date)}</time>
              </div>
              <div className="t-history-meta">
                <span>المدة: {minutesLabel(row.durationMinutes)}</span>
                {row.payableAmount != null && <span>المستحق: {money(row.payableAmount)}</span>}
                <span>سُجل: {dateTime(row.markedAt)}</span>
              </div>
              {row.note && <p className="t-history-note">{row.note}</p>}
            </article>
          ))}
        </div>
        <Pager page={attendancePage.page} pageSize={attendancePage.pageSize} total={attendancePage.meta.total} onPageChange={attendancePage.setPage} buttonClassName="t-secondary" label="سجل" />
      </section>

      <section className="t-history-section">
        <div className="t-section-title"><strong><LogIn size={15} /> آخر عمليات الدخول</strong><span>آخر 5</span></div>
        {logins.length === 0 && <div className="t-empty">لا توجد عمليات دخول مسجلة.</div>}
        <div className="t-history-list">
          {logins.map((login, index) => (
            <article className="t-history-card" key={`${login.createdAt}-${index}`}>
              <div className="t-history-card-head">
                <strong>{deviceLabel(login.userAgent)}</strong>
                <time>{dateTime(login.createdAt)}</time>
              </div>
              <div className="t-history-meta">
                <span>آخر نشاط: {dateTime(login.lastSeenAt)}</span>
                {login.ip && <span dir="ltr">{login.ip}</span>}
              </div>
            </article>
          ))}
        </div>
      </section>

      <p className="t-footnote">كلمات المرور والرموز لا تُحفظ أو تُعرض في هذا السجل.</p>
    </div>
  )
}
