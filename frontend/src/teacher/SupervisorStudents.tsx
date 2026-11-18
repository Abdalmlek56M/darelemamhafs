import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, GraduationCap, Phone, Plus, Search, UserRound } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { SupervisorStudent, SupervisorStudentDetailResponse } from './teacherTypes'
import { dateLabel, percent, statusLabel, statusTone } from './supervisorFormat'
import { money } from './teacherFormat'
import { demoStudentDetail, demoStudents } from './supervisorDemo'
import WhatsAppButton from './WhatsAppButton'

type Props = { canNote: boolean; demo?: boolean; onOpenCircle?: (id: string) => void; canCommunicate?: boolean }

const subscriptionLabels: Record<string, string> = { paid: 'مسدد', partial: 'جزئي', unpaid: 'متأخر', 'not-set': 'لم يحدد' }
const subscriptionTones: Record<string, string> = { paid: 't-badge-ok', partial: 't-badge-gold', unpaid: 't-badge-bad', 'not-set': 't-badge-muted' }

export default function SupervisorStudents({ canNote, demo = false, onOpenCircle, canCommunicate = false }: Props) {
  const [students, setStudents] = useState<SupervisorStudent[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SupervisorStudent | null>(null)

  const load = useCallback(async (term = '') => {
    if (demo) {
      const needle = term.trim().toLowerCase()
      setStudents(demoStudents.filter((student) => !needle
        || student.fullName.toLowerCase().includes(needle)
        || student.studentCode.toLowerCase().includes(needle)
        || (student.guardianPhone ?? '').includes(needle)))
      setLoading(false)
      setError(null)
      return
    }
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
  }, [demo])

  useEffect(() => { void load() }, [load])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void load(search)
  }

  if (selected) {
    return <StudentDetail student={selected} canNote={canNote} demo={demo} onOpenCircle={onOpenCircle} canCommunicate={canCommunicate} onBack={() => setSelected(null)} />
  }

  return (
    <div className="t-page t-page-embedded">
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

      <div className="sup-table-wrap">
        <table className="sup-table">
          <thead><tr><th>الطالبة</th><th>الكود</th><th>الحلقات</th><th>ولي الأمر</th><th>الهاتف</th><th>الاشتراك</th><th>الحالة</th></tr></thead>
          <tbody>
            {students.map((student) => (
              <tr key={student.id} onClick={() => setSelected(student)} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && setSelected(student)}>
                <td><span className="sup-person"><span className="sup-person-avatar">{student.fullName.slice(0, 1)}</span><strong>{student.fullName}</strong></span></td>
                <td dir="ltr">{student.studentCode}</td>
                <td>{student.circles.join('، ') || '—'}</td>
                <td>{student.guardianName ?? '—'}</td>
                <td dir="ltr">{student.guardianPhone ?? '—'}</td>
                <td><span className={`t-badge ${subscriptionTones[student.subscriptionStatus] ?? 't-badge-muted'}`}>{subscriptionLabels[student.subscriptionStatus] ?? 'لم يحدد'}</span></td>
                <td><span className={statusTone(student.status)}>{statusLabel(student.status)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sup-card-list">
        {students.map((student) => (
          <button className="sup-card" key={student.id} onClick={() => setSelected(student)}>
            <span className="sup-person-avatar"><UserRound size={16} /></span>
            <div className="sup-row-copy">
              <strong>{student.fullName}</strong>
              <small>{student.studentCode} · {student.circles.join('، ') || 'بدون حلقة'}</small>
              {student.guardianPhone && <small className="sup-phone"><Phone size={11} /> {student.guardianName ?? 'ولي الأمر'} · <span dir="ltr">{student.guardianPhone}</span></small>}
              <small><span className={`t-badge ${subscriptionTones[student.subscriptionStatus] ?? 't-badge-muted'}`}>{subscriptionLabels[student.subscriptionStatus] ?? 'لم يحدد'}</span></small>
            </div>
            <span className={statusTone(student.status)}>{statusLabel(student.status)}</span>
          </button>
        ))}
      </div>

      <p className="t-footnote">تظهر الطالبات داخل الحلقات المسندة إليك فقط.</p>
    </div>
  )
}

function StudentDetail({ student, canNote, demo, onOpenCircle, canCommunicate, onBack }: { student: SupervisorStudent; canNote: boolean; demo: boolean; onOpenCircle?: (id: string) => void; canCommunicate: boolean; onBack: () => void }) {
  const [detail, setDetail] = useState<SupervisorStudentDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (demo) { setDetail(demoStudentDetail(student.id)); setLoading(false); setError(null); return }
    setLoading(true)
    setError(null)
    try {
      setDetail(await teacherApi.supervisorStudent(student.id))
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل ملف الطالبة.')
    } finally {
      setLoading(false)
    }
  }, [student.id, demo])

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
            {detail.student.circles.length > 0 && (
              <div className="sup-context-bar">
                {detail.student.circles.map((circle) => (
                  <button className="sup-context-chip" key={circle.id} onClick={() => onOpenCircle?.(circle.id)}>{circle.name}</button>
                ))}
              </div>
            )}
            {detail.student.guardianPhone && (
              <WhatsAppButton recipientType="student_guardian" recipientId={detail.student.id} templateKey="student_followup" canCommunicate={canCommunicate} demo={demo} label="واتساب ولي الأمر" />
            )}
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

          <div className="t-section-title"><strong>الاشتراك</strong><span>الشهر الحالي</span></div>
          <div className="t-notes">
            {(!detail.subscription || detail.subscription.length === 0) && <p className="t-muted">لا يوجد استحقاق اشتراك مسجل لهذا الشهر.</p>}
            {(detail.subscription ?? []).map((item, index) => (
              <article className="t-note" key={`${item.circleName}-${index}`}>
                <div className="sup-sub-row">
                  <strong>{item.circleName}</strong>
                  <span className={statusTone(item.status)}>{item.status === 'paid' ? 'مسدد' : item.status === 'partial' ? 'جزئي' : 'متأخر'}</span>
                </div>
                {item.balance !== null && <small>المتبقي: {money(item.balance)} · المستحق: {money(item.amountDue)}</small>}
              </article>
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
              <label className="t-label" htmlFor="student-note">إضافة ملاحظة</label>
              <textarea id="student-note" className="t-textarea" rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="ملاحظة متابعة للطالبة…" />
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
