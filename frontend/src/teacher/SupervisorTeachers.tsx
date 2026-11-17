import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Clock3, Plus, Search, UserRound } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { SupervisorTeacher, SupervisorTeacherDetailResponse } from './teacherTypes'
import { dateLabel, percent, statusLabel, statusTone, whatsappHref } from './supervisorFormat'
import { money } from './teacherFormat'
import { demoTeacherDetail, demoTeachers } from './supervisorDemo'

type Props = { canNote: boolean; demo?: boolean; onOpenCircle?: (id: string) => void; focusId?: string; onFocusConsumed?: () => void }

export default function SupervisorTeachers({ canNote, demo = false, onOpenCircle, focusId, onFocusConsumed }: Props) {
  const [teachers, setTeachers] = useState<SupervisorTeacher[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SupervisorTeacher | null>(null)

  const load = useCallback(async (term = '') => {
    if (demo) {
      const needle = term.trim().toLowerCase()
      setTeachers(demoTeachers.filter((teacher) => !needle
        || teacher.fullName.toLowerCase().includes(needle)
        || (teacher.phone ?? '').includes(needle)))
      setLoading(false)
      setError(null)
      return
    }
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
  }, [demo])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!focusId || selected) return
    const found = teachers.find((item) => item.id === focusId)
    if (found) { setSelected(found); onFocusConsumed?.() }
  }, [focusId, teachers, selected, onFocusConsumed])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void load(search)
  }

  if (selected) {
    return <TeacherDetail teacher={selected} canNote={canNote} demo={demo} onOpenCircle={onOpenCircle} onBack={() => setSelected(null)} />
  }

  return (
    <div className="t-page t-page-embedded">
      <form className="t-search" onSubmit={submit} role="search">
        <Search size={16} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم المعلمة أو الهاتف" aria-label="بحث المعلمات" />
        <button className="t-text-button" type="submit">بحث</button>
      </form>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load(search)}>إعادة المحاولة</button></div>}
      {loading && teachers.length === 0 && <div className="t-empty">جارٍ تحميل المعلمات…</div>}
      {!loading && !error && teachers.length === 0 && <div className="t-empty">لا توجد معلمات في نطاقك.</div>}

      <div className="sup-table-wrap">
        <table className="sup-table">
          <thead><tr><th>المعلمة</th><th>الهاتف</th><th>الحلقات</th><th>الطالبات</th><th>حضور الشهر</th><th>غياب الشهر</th><th>الحالة</th></tr></thead>
          <tbody>
            {teachers.map((teacher) => (
              <tr key={teacher.id} onClick={() => setSelected(teacher)} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && setSelected(teacher)}>
                <td><span className="sup-person"><span className="sup-person-avatar">{teacher.fullName.slice(0, 1)}</span><strong>{teacher.fullName}</strong></span></td>
                <td dir="ltr">{teacher.phone ?? '—'}</td>
                <td>{teacher.circleCount}</td>
                <td>{teacher.studentCount}</td>
                <td className="sup-good">{teacher.presentThisMonth}</td>
                <td className={teacher.missedThisMonth > 0 ? 'sup-warn-text' : undefined}>{teacher.missedThisMonth}</td>
                <td><span className={statusTone(teacher.status)}>{statusLabel(teacher.status)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sup-card-list">
        {teachers.map((teacher) => (
          <button className="sup-card" key={teacher.id} onClick={() => setSelected(teacher)}>
            <span className="sup-person-avatar"><UserRound size={16} /></span>
            <div className="sup-row-copy">
              <strong>{teacher.fullName}</strong>
              <small>{teacher.circleCount} حلقة · {teacher.studentCount} طالبة</small>
              <small className="sup-phone">{teacher.presentThisMonth} حضور هذا الشهر · {teacher.missedThisMonth} غياب</small>
            </div>
            <span className={statusTone(teacher.status)}>{statusLabel(teacher.status)}</span>
          </button>
        ))}
      </div>

      <p className="t-footnote">تظهر المعلمات المرتبطات بالحلقات المسندة إليك.</p>
    </div>
  )
}

function TeacherDetail({ teacher, canNote, demo, onOpenCircle, onBack }: { teacher: SupervisorTeacher; canNote: boolean; demo: boolean; onOpenCircle?: (id: string) => void; onBack: () => void }) {
  const [detail, setDetail] = useState<SupervisorTeacherDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (demo) { setDetail(demoTeacherDetail(teacher.id)); setLoading(false); setError(null); return }
    setLoading(true)
    setError(null)
    try {
      setDetail(await teacherApi.supervisorTeacher(teacher.id))
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل ملف المعلمة.')
    } finally {
      setLoading(false)
    }
  }, [teacher.id, demo])

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

          {detail.teacher.phone && (
            <div className="sup-contact">
              <span dir="ltr">{detail.teacher.phone}</span>
              {whatsappHref(detail.teacher.phone, `مرحبًا ${detail.teacher.fullName}، نود متابعة خطة الحلقات.`) && (
                <a className="sup-wa" target="_blank" rel="noreferrer" href={whatsappHref(detail.teacher.phone, `مرحبًا ${detail.teacher.fullName}، نود متابعة خطة الحلقات.`)!}>واتساب</a>
              )}
            </div>
          )}

          <div className="t-section-title"><strong>الحلقات</strong><span>{detail.circles.length} حلقة</span></div>
          <div className="t-list">
            {detail.circles.length === 0 && <div className="t-empty">لا توجد حلقات مسندة.</div>}
            {detail.circles.map((circle) => (
              <div className="t-row" key={circle.id}>
                <div className="t-row-copy"><button className="sup-link" onClick={() => onOpenCircle?.(circle.id)}>{circle.name}</button><small>{circle.studentCount} طالبة</small></div>
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

          {canNote && !demo && (
            <form className="t-note-form" onSubmit={addNote}>
              <label className="t-label" htmlFor="teacher-note">إضافة ملاحظة</label>
              <textarea id="teacher-note" className="t-textarea" rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="ملاحظة متابعة للمعلمة…" />
              {noteError && <p className="t-error">{noteError}</p>}
              <button className="t-primary" type="submit" disabled={saving}><Plus size={16} /> {saving ? 'جارٍ الحفظ…' : 'حفظ الملاحظة'}</button>
            </form>
          )}
          {demo && <p className="t-hint">الوضع التجريبي للعرض فقط — إضافة الملاحظات معطلة.</p>}
        </>
      )}
    </div>
  )
}
