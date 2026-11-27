import { formatTime12 } from '../lib/dates'
import { addCairoDays, cairoToday } from '../lib/cairoDate'
import { formatDate } from '../lib/formatters'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { TeacherCalendarResponse, TeacherCalendarSession } from './teacherCalendarTypes'

type Props = {
  onBack: () => void
  onOpenLive: (sessionId: string) => void
  onOpenRoster: (sessionId: string) => void
}

const weekDays = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

function shiftDate(value: string, days: number) {
  return addCairoDays(value, days)
}

function statusLabel(session: TeacherCalendarSession) {
  if (session.sessionStatus === 'in_progress') return 'جارية الآن'
  if (session.sessionStatus === 'awaiting_attendance') return 'بانتظار الحضور'
  if (session.sessionStatus === 'completed') return 'مكتملة'
  if (session.sessionStatus === 'cancelled') return 'ملغاة'
  return 'لم تبدأ'
}

function statusTone(session: TeacherCalendarSession) {
  if (session.sessionStatus === 'in_progress') return 't-badge t-badge-live'
  if (session.sessionStatus === 'awaiting_attendance') return 't-badge t-badge-gold'
  if (session.sessionStatus === 'completed') return 't-badge t-badge-ok'
  if (session.sessionStatus === 'cancelled') return 't-badge t-badge-bad'
  return 't-badge'
}

export default function TeacherCalendar({ onBack, onOpenLive, onOpenRoster }: Props) {
  const [from, setFrom] = useState<string | undefined>(undefined)
  const [data, setData] = useState<TeacherCalendarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const today = useMemo(cairoToday, [])

  const load = useCallback(async (start?: string) => {
    setLoading(true)
    setError(null)
    try {
      setData(await teacherApi.teacherCalendar(start, 7))
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل تقويم الأسبوع.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(from) }, [from, load])

  const openSession = (session: TeacherCalendarSession) => {
    if (!session.sessionId) return
    if (session.sessionStatus === 'in_progress') onOpenLive(session.sessionId)
    else if (session.sessionStatus === 'awaiting_attendance' || session.sessionStatus === 'completed') onOpenRoster(session.sessionId)
  }

  return (
    <div className="t-page">
      <header className="t-subheader">
        <button className="t-icon-button" aria-label="رجوع" onClick={onBack}><ArrowRight size={20} /></button>
        <div><span className="t-eyebrow">أسبوعك</span><h1>تقويم الحلقات</h1></div>
        <button className="t-icon-button" aria-label="تحديث" onClick={() => void load(from ?? data?.from)} disabled={loading}><RefreshCw className={loading ? 'spin' : undefined} size={18} /></button>
      </header>

      <div className="t-calendar-toolbar">
        <button className="t-secondary" onClick={() => setFrom(shiftDate(data?.from ?? today, -7))} disabled={loading}><ChevronRight size={16} /> الأسبوع السابق</button>
        <button className="t-secondary" onClick={() => { setFrom(undefined); void load(undefined) }} disabled={loading}><CalendarDays size={16} /> هذا الأسبوع</button>
        <button className="t-secondary" onClick={() => setFrom(shiftDate(data?.from ?? today, 7))} disabled={loading}>الأسبوع التالي <ChevronLeft size={16} /></button>
      </div>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load(from)}>إعادة المحاولة</button></div>}
      {loading && !data && <div className="t-empty">جارٍ تحميل التقويم…</div>}

      {data && (
        <div className="t-calendar-week">
          {data.days.map((day) => (
            <article className={`t-calendar-day ${day.date === today ? 'is-today' : ''}`} key={day.date}>
              <div className="t-calendar-day-head">
                <span>{weekDays[day.dayOfWeek] ?? ''}</span>
                <strong>{formatDate(day.date)}</strong>
              </div>
              {day.sessions.length === 0 && <p className="t-calendar-empty">لا حلقات</p>}
              {day.sessions.map((session) => (
                <button
                  key={`${session.slotId}-${day.date}`}
                  type="button"
                  className="t-calendar-session"
                  onClick={() => openSession(session)}
                  disabled={!session.sessionId || session.sessionStatus === 'cancelled'}
                >
                  <div className="t-calendar-session-head">
                    <strong>{session.circleName}</strong>
                    <span className={statusTone(session)}>{statusLabel(session)}</span>
                  </div>
                  <small>{formatTime12(session.startsAt)} · {session.durationMinutes} دقيقة · {session.studentCount} طالبة</small>
                  {session.sessionId && <b>{session.sessionStatus === 'in_progress' ? 'فتح الحلقة' : session.sessionStatus === 'awaiting_attendance' ? 'إكمال الحضور' : 'عرض الحلقة'}</b>}
                </button>
              ))}
            </article>
          ))}
        </div>
      )}

      <p className="t-footnote">كل الأوقات والتواريخ بتوقيت القاهرة (Africa/Cairo).</p>
    </div>
  )
}
