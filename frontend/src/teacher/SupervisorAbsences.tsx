import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, Phone, RefreshCw, UserRound, Users } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { SupervisorAbsencesResponse } from './teacherTypes'
import { dateLabel, statusLabel, statusTone, todayCairo } from './supervisorFormat'
import { demoAbsences } from './supervisorDemo'

type Props = { demo: boolean }

export default function SupervisorAbsences({ demo }: Props) {
  const [date, setDate] = useState(todayCairo())
  const [data, setData] = useState<SupervisorAbsencesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (day: string) => {
    if (demo) { setData(demoAbsences); setLoading(false); setError(null); return }
    setLoading(true)
    setError(null)
    try {
      setData(await teacherApi.supervisorAbsences(day))
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل الغياب.')
    } finally {
      setLoading(false)
    }
  }, [demo])

  useEffect(() => { void load(date) }, [date, load])

  const teachers = data?.teachers ?? []
  const students = data?.students ?? []

  return (
    <div className="sup-page">
      <div className="sup-page-head">
        <div><span className="sup-eyebrow">متابعة يومية</span><h1>الغياب</h1><p>المعلمات التي لم تسجل والطالبات الغائبات في يوم واحد.</p></div>
        <div className="sup-head-actions">
          <label className="sup-date"><CalendarDays size={16} /><input type="date" value={date} max={todayCairo()} onChange={(event) => setDate(event.target.value || todayCairo())} /></label>
          <button className="sup-icon-button" onClick={() => void load(date)} disabled={loading} aria-label="تحديث"><RefreshCw size={18} /></button>
        </div>
      </div>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load(date)}>إعادة المحاولة</button></div>}

      <div className="sup-kpi-grid sup-kpi-grid-three">
        <div className="sup-kpi"><span className="sup-kpi-icon is-warn"><Users size={18} /></span><span>معلمات لم يسجلن</span><strong>{teachers.length}</strong><small>{dateLabel(date)}</small></div>
        <div className="sup-kpi"><span className="sup-kpi-icon"><UserRound size={18} /></span><span>طالبات غائبات</span><strong>{students.length}</strong><small>{students.filter((item) => item.status === 'excused').length} بعذر</small></div>
        <div className="sup-kpi"><span className="sup-kpi-icon"><CalendarDays size={18} /></span><span>إجمالي المتابعات</span><strong>{teachers.length + students.length}</strong><small>تحتاج إجراء</small></div>
      </div>

      <section className="sup-panel">
        <div className="sup-panel-head"><div><h2>معلمات لم يسجلن</h2><span>{teachers.length}</span></div></div>
        {loading && teachers.length === 0 && <p className="sup-muted">جارٍ التحميل…</p>}
        {!loading && teachers.length === 0 && <p className="sup-muted">لا توجد معلمات متأخرات عن التسجيل.</p>}
        <div className="sup-list">
          {teachers.map((item) => (
            <div className="sup-row" key={`${item.scheduleSlotId}-${item.startsAt}`}>
              <span className="sup-kpi-icon is-warn"><Users size={16} /></span>
              <div className="sup-row-copy"><strong>{item.teacherName}</strong><small>{item.circleName} · {item.startsAt} · {item.durationMinutes} دقيقة</small></div>
              {item.phone && <span className="sup-phone" dir="ltr"><Phone size={12} /> {item.phone}</span>}
              <span className="t-badge t-badge-bad">لم تسجل</span>
            </div>
          ))}
        </div>
      </section>

      <section className="sup-panel">
        <div className="sup-panel-head"><div><h2>طالبات غائبات</h2><span>{students.length}</span></div></div>
        {loading && students.length === 0 && <p className="sup-muted">جارٍ التحميل…</p>}
        {!loading && students.length === 0 && <p className="sup-muted">لا يوجد غياب مسجل في هذا اليوم.</p>}
        <div className="sup-list">
          {students.map((item) => (
            <div className="sup-row" key={item.attendanceId}>
              <span className="sup-kpi-icon"><UserRound size={16} /></span>
              <div className="sup-row-copy"><strong>{item.studentName}</strong><small>{item.circleName} · {item.teacherName} · {item.studentCode}</small>{item.note && <small>{item.note}</small>}</div>
              {item.guardianPhone && <span className="sup-phone" dir="ltr"><Phone size={12} /> {item.guardianPhone}</span>}
              <span className={statusTone(item.status)}>{statusLabel(item.status)}</span>
            </div>
          ))}
        </div>
      </section>

      <p className="sup-footnote">الغياب يظهر بعد انتهاء وقت الحلقة. النطاق يحدد المعلمات والطالبات الظاهرة.</p>
    </div>
  )
}
