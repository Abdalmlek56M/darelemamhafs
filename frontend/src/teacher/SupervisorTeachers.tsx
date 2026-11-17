import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Clock3, Plus, RefreshCw, Search, UserRound } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { SupervisorTeacher, SupervisorTeacherDetailResponse } from './teacherTypes'
import { dateLabel, percent, statusLabel, statusTone } from './supervisorFormat'
import { money } from './teacherFormat'

type Props = { canNote: boolean }

export default function SupervisorTeachers({ canNote }: Props) {
  const [teachers, setTeachers] = useState<SupervisorTeacher[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SupervisorTeacher | null>(null)

  const load = useCallback(async (term = '') => {
    setLoading(true)
    setError(null)
    try {
      const data = await teacherApi.supervisorTeachers(term)
      setTeachers(data.teachers)
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل المعلمات.')
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
    return <TeacherDetail teacher={selected} canNote={canNote} onBack={() => setSelected(null)} />
  }

  return (
    <div className="t-page t-page-embedded">
      <header className="t-subheader">
        <div><span className="t-eyebrow">الإشراف</span><h1>المعلمات</h1></div>
        <button className="t-icon-button" aria-label="تحديث" onClick={() => void load(search)}><RefreshCw size={18} /></button>
      </header>

      <form className="t-search" onSubmit={submit} role="search">
        <Search size={16} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="ابحث باسم المعلمة أو الهاتف"
          aria-label="بحث المعلمات"
        />
        <button className="t-text-button" type="submit">بحث</button>
      </form>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load(search)}>إعادة المحاولة</button></div>}
      {loading && teachers.length === 0 && <div className="t-empty">جارٍ تحميل المعلمات…</div>}
      {!loading && !error && teachers.length === 0 && <div className="t-empty">لا توجد معلمات في نطاقك.</div>}

      <div className="t-list">
        {teachers.map((teacher) => (
          <button className="t-row t-row-button" key={teacher.id} onClick={() => setSelected(teacher)}>
            <span className="t-avatar"><UserRound size={16} /></span>
            <div className="t-row-copy">
              <strong>{teacher.fullName}</strong>
              <small>{teacher.circleCount} حلقة · {teacher.studentCount} طالبة</small>
              <small className="t-row-meta">{teacher.presentThisMonth} حضور هذا الشهر · {teacher.missedThisMonth} غياب</small>
            </div>
            <span className={statusTone(teacher.status)}>{statusLabel(teacher.status)}</span>
          </button>
        ))}
      </div>

      <p className="t-footnote">تظهر المعلمات المرتبطات بالحلقات المسندة إليك.</p>
    </div>
  )
}

function TeacherDetail({ teacher, canNote, onBack }: { teacher: SupervisorTeacher; canNote: boolean; onBack: () => void }) {
  const [detail, setDetail] = useState<SupervisorTeacherDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDetail(await teacherApi.supervisorTeacher(teacher.id))
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل ملف المعلمة.')
    } finally {
      setLoading(false)
    }
  }, [teacher.id])

  useEffect(() => { void load() }, [load])

  const addNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (note.trim().length < 2) { setNoteError('اكتب ملاحظة أوضح.'); return }
    setSaving(true)
    setNoteError(null)
    try {
      await teacherApi.addTeacherNote(teacher.id, note.trim())
      setNote('')
      await load()
    } catch (err) {
      setNoteError(err instanceof TeacherApiError ? err.message : 'تعذر حفظ الملاحظة.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="t-page t-page-embedded">
      <header className="t-subheader">
        <button className="t-icon-button" aria-label="رجوع" onClick={onBack}><ArrowRight size={20} /></button>
        <div><span className="t-eyebrow">ملف المعلمة</span><h1>{teacher.fullName}</h1></div>
      </header>

      {loading && !detail && <div className="t-empty">جارٍ تحميل الملف…</div>}
      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load()}>إعادة المحاولة</button></div>}

      {detail && (
        <>
          <div className="t-stat-grid t-stat-grid-four">
            <div className="t-stat"><span>نسبة الحضور</span><strong>{percent(detail.attendance.rate)}</strong><small>حضور {detail.attendance.present} من أصل {detail.attendance.scheduled}</small></div>
            <div className="t-stat"><span>ساعات الشهر</span><strong>{detail.attendance.hours}</strong><small>ساعة</small></div>
            <div className="t-stat"><span>زيادة</span><strong>{detail.attendance.overtimeMinutes}</strong><small>دقيقة</small></div>
            <div className="t-stat"><span>نقص</span><strong>{detail.attendance.undertimeMinutes}</strong><small>دقيقة</small></div>
          </div>

          {detail.teacher.hourlyRate !== null && (
            <div className="t-pay-banner compact"><span>أجر الساعة</span><strong>{money(detail.teacher.hourlyRate)}</strong><small>مرئي بصلاحية المالية</small></div>
          )}

          <div className="t-section-title"><strong>الحلقات</strong><span>{detail.circles.length} حلقة</span></div>
          <div className="t-list">
            {detail.circles.length === 0 && <div className="t-empty">لا توجد حلقات مسندة.</div>}
            {detail.circles.map((circle) => (
              <div className="t-row" key={circle.id}>
                <div className="t-row-copy"><strong>{circle.name}</strong><small>{circle.studentCount} طالبة</small></div>
                <span className={statusTone(circle.isActive ? 'active' : 'inactive')}>{circle.isActive ? 'نشطة' : 'غير نشطة'}</span>
              </div>
            ))}
          </div>

          <div className="t-section-title"><strong>سجل الحصص</strong><span>{detail.history.length} حصة</span></div>
          <div className="t-list">
            {detail.history.length === 0 && <div className="t-empty">لا يوجد سجل في هذه الفترة.</div>}
            {detail.history.map((row) => (
              <div className="t-row" key={row.id}>
                <div className="t-row-copy">
                  <strong>{row.circleName}</strong>
                  <small>{dateLabel(row.date)} · {row.startsAt} · {row.durationMinutes} دقيقة</small>
                  <small className="t-row-meta"><Clock3 size={10} /> حضور {row.presentStudents} · غياب {row.absentStudents}</small>
                  {row.note && <small>{row.note}</small>}
                </div>
                <div className="t-row-actions">
                  <span className={statusTone(row.status)}>{statusLabel(row.status)}</span>
                  {row.payableAmount !== null && <span className="t-chip t-chip-ok">{money(row.payableAmount)}</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="t-section-title"><strong>الملاحظات</strong><span>{detail.notes.length} ملاحظة</span></div>
          <div className="t-notes">
            {detail.notes.length === 0 && <p className="t-muted">لا توجد ملاحظات بعد.</p>}
            {detail.notes.map((item) => (
              <article className="t-note" key={item.id}>
                <p>{item.text}</p>
                <small>{dateLabel(item.createdAt)} · {item.createdBy ?? 'الإدارة'}</small>
              </article>
            ))}
          </div>

          {canNote && (
            <form className="t-note-form" onSubmit={addNote}>
              <label className="t-label" htmlFor="teacher-note">إضافة ملاحظة</label>
              <textarea
                id="teacher-note"
                className="t-textarea"
                rows={3}
                maxLength={4000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="ملاحظة متابعة للمعلمة…"
              />
              {noteError && <p className="t-error">{noteError}</p>}
              <button className="t-primary" type="submit" disabled={saving}><Plus size={16} /> {saving ? 'جارٍ الحفظ…' : 'حفظ الملاحظة'}</button>
            </form>
          )}
        </>
      )}
    </div>
  )
}

