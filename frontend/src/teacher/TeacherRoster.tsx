import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Search, Users } from 'lucide-react'
import type { EndResponse, RosterResponse, RosterStudent, Slot } from './teacherTypes'
import { money } from './teacherFormat'

type Status = 'present' | 'excused' | 'absent'
type Props = {
  roster: RosterResponse | null
  slot: Slot | null
  endResult: EndResponse | null
  hourlyRate: number
  loading: boolean
  busy: boolean
  error: string | null
  onBack: () => void
  onSubmit: (marks: { enrollmentId: string; status: Status }[]) => Promise<{ present: number; excused: number; absent: number; total: number }>
  onDone: () => void
}

const statusLabel: Record<Status, string> = { present: 'حاضر', excused: 'بعذر', absent: 'غائب' }

export default function TeacherRoster({ roster, slot, endResult, hourlyRate, loading, busy, error, onBack, onSubmit, onDone }: Props) {
  const [marks, setMarks] = useState<Record<string, Status>>({})
  const [query, setQuery] = useState('')
  const [success, setSuccess] = useState<{ present: number; excused: number; absent: number; total: number } | null>(null)

  useEffect(() => {
    if (!roster) return
    const next: Record<string, Status> = {}
    for (const student of roster.students) next[student.enrollmentId] = student.status ?? 'present'
    setMarks(next)
  }, [roster])

  const students = roster?.students ?? []
  const filtered = useMemo(() => {
    const value = query.trim()
    if (!value) return students
    return students.filter((student) => student.studentName.includes(value) || student.studentCode.includes(value))
  }, [students, query])

  const counts = useMemo(() => {
    let present = 0, excused = 0, absent = 0
    for (const student of students) {
      const status = marks[student.enrollmentId] ?? 'present'
      if (status === 'present') present++
      else if (status === 'excused') excused++
      else absent++
    }
    return { present, excused, absent, total: students.length }
  }, [marks, students])

  const setStudent = (student: RosterStudent, status: Status) => {
    setMarks((current) => ({ ...current, [student.enrollmentId]: status }))
  }
  const setAll = (status: Status) => {
    const next: Record<string, Status> = {}
    for (const student of students) next[student.enrollmentId] = status
    setMarks(next)
  }

  const submit = async () => {
    try {
      const payload = students.map((student) => ({ enrollmentId: student.enrollmentId, status: marks[student.enrollmentId] ?? 'present' as Status }))
      const result = await onSubmit(payload)
      setSuccess(result)
    } catch { /* the parent shows the error */ }
  }

  const actual = endResult?.actualDurationMinutes ?? slot?.actualDurationMinutes ?? 0
  const payable = endResult?.payableDurationMinutes ?? slot?.payableDurationMinutes ?? 0
  const amount = endResult?.payableAmount ?? (payable * hourlyRate / 60)

  if (loading && !roster) return <div className="t-empty">جارٍ تحميل الطالبات…</div>
  if (!roster) return <div className="t-error-card"><p>{error ?? 'تعذر تحميل قائمة الطالبات.'}</p><button className="t-secondary" onClick={onBack}>رجوع</button></div>

  return (
    <div className="t-page">
      <header className="t-subheader">
        <button className="t-icon-button" aria-label="رجوع" onClick={onBack}><ArrowRight size={20} /></button>
        <div><span className="t-eyebrow">{slot?.circleName ?? 'الحلقة'}</span><h1>حضور الطالبات</h1></div>
      </header>

      <div className="t-summary-row">
        <span className="t-pill t-pill-ok">{counts.present} حاضر</span>
        <span className="t-pill t-pill-gold">{counts.excused} بعذر</span>
        <span className="t-pill t-pill-bad">{counts.absent} غائب</span>
        <span className="t-pill">الإجمالي {counts.total}</span>
      </div>

      <div className="t-search">
        <Search size={17} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحثي باسم الطالبة أو الكود" />
      </div>
      <div className="t-bulk">
        <button onClick={() => setAll('present')}>الكل حاضر</button>
        <button onClick={() => setAll('excused')}>الكل بعذر</button>
        <button onClick={() => setAll('absent')}>الكل غائب</button>
      </div>

      <div className="t-roster">
        {filtered.map((student) => {
          const status = marks[student.enrollmentId] ?? 'present'
          return (
            <div className="t-student" key={student.enrollmentId}>
              <span className="t-avatar">{student.studentName.slice(0, 1)}</span>
              <div className="t-student-copy"><strong>{student.studentName}</strong><small>{student.studentCode} · {student.enrollmentStatus}</small></div>
              <div className="t-status-toggle" role="group" aria-label={`حالة ${student.studentName}`}>
                {(['present', 'excused', 'absent'] as Status[]).map((value) => (
                  <button key={value} className={`${value} ${status === value ? 'selected' : ''}`} onClick={() => setStudent(student, value)} aria-pressed={status === value}>
                    {statusLabel[value]}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && <div className="t-empty">لا توجد نتائج.</div>}
      {error && <p className="t-error">{error}</p>}

      <div className="t-sticky">
        <button className="t-primary" onClick={() => void submit()} disabled={busy || counts.total === 0}>
          <Check size={18} /> {busy ? 'جارٍ التسليم…' : `تسجيل الحضور (${counts.present} · ${counts.excused} · ${counts.absent})`}
        </button>
      </div>

      {success && (
        <div className="t-sheet-backdrop">
          <div className="t-sheet">
            <div className="t-sheet-head"><Users size={22} /><div><strong>تم تسجيل الحلقة</strong><small>{slot?.circleName ?? 'الحلقة'} · تم حفظ الحضور والأجر.</small></div></div>
            <div className="t-mini-grid">
              <div><span>حاضر</span><strong>{success.present}</strong></div>
              <div><span>بعذر</span><strong>{success.excused}</strong></div>
              <div><span>غائب</span><strong>{success.absent}</strong></div>
              <div><span>الأجر</span><strong>{money(amount)}</strong></div>
              <div><span>الفعلية</span><strong>{actual} د</strong></div>
              <div><span>المحتسبة</span><strong>{payable} د</strong></div>
            </div>
            {endResult?.note && <p className="t-note">ملاحظة الإنهاء: {endResult.note}</p>}
            <button className="t-primary" onClick={onDone}>تم</button>
          </div>
        </div>
      )}
    </div>
  )
}
