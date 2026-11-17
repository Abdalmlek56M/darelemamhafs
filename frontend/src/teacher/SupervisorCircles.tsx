import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, BookOpen, RefreshCw, Search, Users } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { SupervisorCircle, SupervisorCircleDetailResponse } from './teacherTypes'
import { dateLabel, dayNames, statusLabel, statusTone } from './supervisorFormat'

export default function SupervisorCircles() {
  const [circles, setCircles] = useState<SupervisorCircle[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SupervisorCircle | null>(null)

  const load = useCallback(async (term = '') => {
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
  }, [])

  useEffect(() => { void load() }, [load])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void load(search)
  }

  if (selected) {
    return <CircleDetail circle={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div className="t-page t-page-embedded">
      <header className="t-subheader">
        <div><span className="t-eyebrow">الإشراف</span><h1>الحلقات</h1></div>
        <button className="t-icon-button" aria-label="تحديث" onClick={() => void load(search)}><RefreshCw size={18} /></button>
      </header>

      <form className="t-search" onSubmit={submit} role="search">
        <Search size={16} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="ابحث باسم الحلقة أو المعلمة"
          aria-label="بحث الحلقات"
        />
        <button className="t-text-button" type="submit">بحث</button>
      </form>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load(search)}>إعادة المحاولة</button></div>}
      {loading && circles.length === 0 && <div className="t-empty">جارٍ تحميل الحلقات…</div>}
      {!loading && !error && circles.length === 0 && <div className="t-empty">لا توجد حلقات في نطاقك.</div>}

      <div className="t-list">
        {circles.map((circle) => (
          <button className="t-row t-row-button" key={circle.id} onClick={() => setSelected(circle)}>
            <span className="t-avatar"><BookOpen size={16} /></span>
            <div className="t-row-copy">
              <strong>{circle.name}</strong>
              <small>{circle.teacherName ?? 'بدون معلمة'} · {circle.studentCount} طالبة</small>
              <small className="t-row-meta">
                {circle.schedule.slice(0, 3).map((slot) => `${dayNames[slot.dayOfWeek]} ${slot.startsAt}`).join(' · ') || 'بدون مواعيد'}
              </small>
            </div>
            <span className={statusTone(circle.isActive ? 'active' : 'inactive')}>{circle.isActive ? 'نشطة' : 'غير نشطة'}</span>
          </button>
        ))}
      </div>

      <p className="t-footnote">تظهر الحلقات التي تشرفين عليها فقط. المبالغ تظهر بصلاحية المالية.</p>
    </div>
  )
}

function CircleDetail({ circle, onBack }: { circle: SupervisorCircle; onBack: () => void }) {
  const [detail, setDetail] = useState<SupervisorCircleDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDetail(await teacherApi.supervisorCircle(circle.id))
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل الحلقة.')
    } finally {
      setLoading(false)
    }
  }, [circle.id])

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
              <span className="t-chip" key={`${slot.dayOfWeek}-${slot.startsAt}-${index}`}>
                {dayNames[slot.dayOfWeek]} · {slot.startsAt} · {slot.durationMinutes} د
              </span>
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

