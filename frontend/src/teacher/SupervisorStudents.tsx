import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, GraduationCap, Phone, Plus, RefreshCw, Search, UserRound } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { SupervisorStudent, SupervisorStudentDetailResponse } from './teacherTypes'
import { dateLabel, percent, statusLabel, statusTone } from './supervisorFormat'

type Props = { canNote: boolean }

export default function SupervisorStudents({ canNote }: Props) {
  const [students, setStudents] = useState<SupervisorStudent[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SupervisorStudent | null>(null)

  const load = useCallback(async (term = '') => {
    setLoading(true)
    setError(null)
    try {
      const data = await teacherApi.supervisorStudents(term)
      setStudents(data.students)
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل الطالبات.')
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
    return <StudentDetail student={selected} canNote={canNote} onBack={() => setSelected(null)} />
  }

  return (
    <div className="t-page t-page-embedded">
      <header className="t-subheader">
        <div><span className="t-eyebrow">الإشراف</span><h1>الطالبات</h1></div>
        <button className="t-icon-button" aria-label="تحديث" onClick={() => void load(search)}><RefreshCw size={18} /></button>
      </header>

      <form className="t-search" onSubmit={submit} role="search">
        <Search size={16} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="ابحث بالاسم أو الكود أو الهاتف"
          aria-label="بحث الطالبات"
        />
        <button className="t-text-button" type="submit">بحث</button>
      </form>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load(search)}>إعادة المحاولة</button></div>}
      {loading && students.length === 0 && <div className="t-empty">جارٍ تحميل الطالبات…</div>}
      {!loading && !error && students.length === 0 && <div className="t-empty">لا توجد طالبات في نطاقك.</div>}

      <div className="t-list">
        {students.map((student) => (
          <button className="t-row t-row-button" key={student.id} onClick={() => setSelected(student)}>
            <span className="t-avatar"><UserRound size={16} /></span>
            <div className="t-row-copy">
              <strong>{student.fullName}</strong>
              <small>{student.studentCode} · {student.circles.join('، ') || 'بدون حلقة'}</small>
              {student.guardianPhone && (
                <small className="t-row-meta">
                  <Phone size={10} />
                  <span>{student.guardianName ?? 'ولي الأمر'}</span>
                  <span dir="ltr">{student.guardianPhone}</span>
                </small>
              )}
            </div>
            <span className={statusTone(student.status)}>{statusLabel(student.status)}</span>
          </button>
        ))}
      </div>

      <p className="t-footnote">تظهر الطالبات داخل الحلقات المسندة إليك فقط.</p>
    </div>
  )
}

function StudentDetail({ student, canNote, onBack }: { student: SupervisorStudent; canNote: boolean; onBack: () => void }) {
  const [detail, setDetail] = useState<SupervisorStudentDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDetail(await teacherApi.supervisorStudent(student.id))
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل ملف الطالبة.')
    } finally {
      setLoading(false)
    }
  }, [student.id])

  useEffect(() => { void load() }, [load])

  const addNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (note.trim().length < 2) { setNoteError('اكتب ملاحظة أوضح.'); return }
    setSaving(true)
    setNoteError(null)
    try {
      await teacherApi.addStudentNote(student.id, note.trim())
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
        <div><span className="t-eyebrow">ملف الطالبة</span><h1>{student.fullName}</h1></div>
      </header>

      {loading && !detail && <div className="t-empty">جارٍ تحميل الملف…</div>}
      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load()}>إعادة المحاولة</button></div>}

      {detail && (
        <>
          <div className="t-supervisor-card">
            <div className="t-supervisor-total">
              <GraduationCap size={16} />
              <span>الكود</span>
              <strong>{detail.student.studentCode}</strong>
              <span className={statusTone(detail.student.status)}>{statusLabel(detail.student.status)}</span>
            </div>
            <div className="t-mini-grid">
              <div><span>ولي الأمر</span><strong>{detail.student.guardianName ?? '—'}</strong></div>
              <div><span>هاتف ولي الأمر</span><strong dir="ltr">{detail.student.guardianPhone ?? '—'}</strong></div>
              <div><span>الانضمام</span><strong>{dateLabel(detail.student.joinedOn)}</strong></div>
              <div><span>الحلقات</span><strong>{detail.student.circles.map((circle) => circle.name).join('، ') || '—'}</strong></div>
            </div>
          </div>

          <div className="t-section-title"><strong>الحضور</strong><span>من {dateLabel(detail.period.from)} إلى {dateLabel(detail.period.to)}</span></div>
          <div className="t-stat-grid t-stat-grid-four">
            <div className="t-stat"><span>حاضرة</span><strong>{detail.attendance.present}</strong></div>
            <div className="t-stat"><span>غائبة</span><strong>{detail.attendance.absent}</strong></div>
            <div className="t-stat"><span>بعذر</span><strong>{detail.attendance.excused}</strong></div>
            <div className="t-stat"><span>النسبة</span><strong>{percent(detail.attendance.rate)}</strong><small>{detail.attendance.marked} سجل</small></div>
          </div>

          <div className="t-section-title"><strong>سجل الحضور</strong><span>{detail.history.length} سجل</span></div>
          <div className="t-list">
            {detail.history.length === 0 && <div className="t-empty">لا يوجد سجل في هذه الفترة.</div>}
            {detail.history.map((row, index) => (
              <div className="t-row" key={`${row.date}-${index}`}>
                <div className="t-row-copy">
                  <strong>{row.circleName}</strong>
                  <small>{dateLabel(row.date)} · {row.startsAt}</small>
                  {row.note && <small>{row.note}</small>}
                </div>
                <span className={statusTone(row.status)}>{statusLabel(row.status)}</span>
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
              <label className="t-label" htmlFor="student-note">إضافة ملاحظة</label>
              <textarea
                id="student-note"
                className="t-textarea"
                rows={3}
                maxLength={4000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="ملاحظة متابعة للطالبة…"
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

