import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, BookOpen, Search, Users } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { SupervisorCircle, SupervisorCircleDetailResponse } from './teacherTypes'
import { dateLabel, dayNames, statusLabel, statusTone } from './supervisorFormat'
import { demoCircleDetail, demoCircles } from './supervisorDemo'

type Props = { demo?: boolean }

export default function SupervisorCircles({ demo = false }: Props) {
  const [circles, setCircles] = useState<SupervisorCircle[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SupervisorCircle | null>(null)

  const load = useCallback(async (term = '') => {
    if (demo) {
      const needle = term.trim().toLowerCase()
      setCircles(demoCircles.filter((circle) => !needle
        || circle.name.toLowerCase().includes(needle)
        || (circle.teacherName ?? '').toLowerCase().includes(needle)))
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await teacherApi.supervisorCircles(term)
      setCircles(data.circles)
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل الحلقات.')
    } finally {
      setLoading(false)
    }
  }, [demo])

  useEffect(() => { void load() }, [load])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void load(search)
  }

  if (selected) {
    return <CircleDetail circle={selected} demo={demo} onBack={() => setSelected(null)} />
  }

  return (
    <div className="t-page t-page-embedded">
      <form className="t-search" onSubmit={submit} role="search">
        <Search size={16} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم الحلقة أو المعلمة" aria-label="بحث الحلقات" />
        <button className="t-text-button" type="submit">بحث</button>
      </form>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load(search)}>إعادة المحاولة</button></div>}
      {loading && circles.length === 0 && <div className="t-empty">جارٍ تحميل الحلقات…</div>}
      {!loading && !error && circles.length === 0 && <div className="t-empty">لا توجد حلقات في نطاقك.</div>}

      <div className="sup-table-wrap">
        <table className="sup-table">
          <thead><tr><th>الحلقة</th><th>المعلمة</th><th>الطالبات</th><th>المواعيد</th><th>البداية</th><th>الحالة</th></tr></thead>
          <tbody>
            {circles.map((circle) => (
              <tr key={circle.id} onClick={() => setSelected(circle)} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && setSelected(circle)}>
                <td><span className="sup-person"><span className="sup-person-avatar">{circle.name.slice(0, 1)}</span><strong>{circle.name}</strong></span></td>
                <td>{circle.teacherName ?? '—'}</td>
                <td>{circle.studentCount}</td>
                <td>{circle.schedule.map((slot) => `${dayNames[slot.dayOfWeek]} ${slot.startsAt}`).join(' · ') || '—'}</td>
                <td>{dateLabel(circle.startsOn)}</td>
                <td><span className={statusTone(circle.isActive ? 'active' : 'inactive')}>{circle.isActive ? 'نشطة' : 'غير نشطة'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sup-card-list">
        {circles.map((circle) => (
          <button className="sup-card" key={circle.id} onClick={() => setSelected(circle)}>
            <span className="sup-person-avatar"><BookOpen size={16} /></span>
            <div className="sup-row-copy">
              <strong>{circle.name}</strong>
              <small>{circle.teacherName ?? 'بدون معلمة'} · {circle.studentCount} طالبة</small>
              <small className="sup-phone">{circle.schedule.slice(0, 3).map((slot) => `${dayNames[slot.dayOfWeek]} ${slot.startsAt}`).join(' · ') || 'بدون مواعيد'}</small>
            </div>
            <span className={statusTone(circle.isActive ? 'active' : 'inactive')}>{circle.isActive ? 'نشطة' : 'غير نشطة'}</span>
          </button>
        ))}
      </div>

      <p className="t-footnote">تظهر الحلقات التي تشرفين عليها فقط. المبالغ تظهر بصلاحية المالية.</p>
    </div>
  )
}

function CircleDetail({ circle, demo, onBack }: { circle: SupervisorCircle; demo: boolean; onBack: () => void }) {
  const [detail, setDetail] = useState<SupervisorCircleDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (demo) { setDetail(demoCircleDetail(circle.id)); setLoading(false); setError(null); return }
    setLoading(true)
    setError(null)
    try {
      setDetail(await teacherApi.supervisorCircle(circle.id))
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل الحلقة.')
    } finally {
      setLoading(false)
    }
  }, [circle.id, demo])

  useEffect(() => { void load() }, [load])

  return (
    <div className="t-page t-page-embedded">
      <header className="t-subheader">
        <button className="t-icon-button" aria-label="رجوع" onClick={onBack}><ArrowRight size={20} /></button>
        <div><span className="t-eyebrow">ملف الحلقة</span><h1>{circle.name}</h1></div>
      </header>

      {loading && !detail && <div className="t-empty">جارٍ تحميل الحلقة…</div>}
      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load()}>إعادة المحاولة</button></div>}

      {detail && (
        <>
          <div className="t-supervisor-card">
            <div className="t-supervisor-total">
              <Users size={16} />
              <span>الطالبات</span>
              <strong>{detail.studentCount}</strong>
              <span className={statusTone(detail.circle.isActive ? 'active' : 'inactive')}>{detail.circle.isActive ? 'نشطة' : 'غير نشطة'}</span>
            </div>
            <div className="t-mini-grid">
              <div><span>المعلمة</span><strong>{detail.circle.teacherName ?? '—'}</strong></div>
              <div><span>بداية الحلقة</span><strong>{dateLabel(detail.circle.startsOn)}</strong></div>
              <div><span>المواعيد</span><strong>{detail.schedule.length}</strong></div>
              <div><span>آخر حصة</span><strong>{detail.sessions[0] ? dateLabel(detail.sessions[0].date) : '—'}</strong></div>
            </div>
          </div>

          <div className="t-section-title"><strong>المواعيد</strong><span>{detail.schedule.length} موعد</span></div>
          <div className="t-chip-row">
            {detail.schedule.length === 0 && <span className="t-muted">لا توجد مواعيد.</span>}
            {detail.schedule.map((slot, index) => (
              <span className="t-chip" key={`${slot.dayOfWeek}-${slot.startsAt}-${index}`}>{dayNames[slot.dayOfWeek]} · {slot.startsAt} · {slot.durationMinutes} د</span>
            ))}
          </div>

          <div className="t-section-title"><strong>الطالبات</strong><span>{detail.roster.length}</span></div>
          <div className="t-list">
            {detail.roster.length === 0 && <div className="t-empty">لا توجد طالبات مسجلات.</div>}
            {detail.roster.map((student) => (
              <div className="t-row" key={student.id}>
                <div className="t-row-copy">
                  <strong>{student.fullName}</strong>
                  <small>{student.studentCode} · {student.guardianName ?? 'بدون ولي أمر'}</small>
                  {student.guardianPhone && <small className="t-row-meta" dir="ltr">{student.guardianPhone}</small>}
                </div>
                <span className={statusTone(student.enrollmentStatus)}>{statusLabel(student.enrollmentStatus)}</span>
              </div>
            ))}
          </div>

          <div className="t-section-title"><strong>آخر الحصص</strong><span>{detail.sessions.length}</span></div>
          <div className="t-list">
            {detail.sessions.length === 0 && <div className="t-empty">لا توجد حصص مسجلة.</div>}
            {detail.sessions.map((session, index) => (
              <div className="t-row" key={`${session.date}-${index}`}>
                <div className="t-row-copy">
                  <strong>{dateLabel(session.date)} · {session.startsAt}</strong>
                  <small>حضور {session.presentStudents} · غياب {session.missingStudents}</small>
                  {session.note && <small>{session.note}</small>}
                </div>
                <span className={statusTone(session.status)}>{statusLabel(session.status)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
