import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Search, Users, WifiOff } from 'lucide-react'
import type { EndResponse, RosterResponse, RosterStudent, Slot } from './teacherTypes'
import { enrollmentStatusLabel, money } from './teacherFormat'
import { roomApi } from '../room/roomApi'

type Status = 'present' | 'excused' | 'absent'
type Props = {
  roster: RosterResponse | null
  slot: Slot | null
  endResult: EndResponse | null
  hourlyRate: number
  loading: boolean
  busy: boolean
  error: string | null
  canEarnings: boolean
  onBack: () => void
  onSubmit: (marks: { enrollmentId: string; status: Status }[]) => Promise<{ present: number; excused: number; absent: number; total: number; queued?: boolean }>
  onDone: () => void
}

const statusLabel: Record<Status, string> = { present: 'حاضر', excused: 'بعذر', absent: 'غائب' }

function ineligibilityReasonLabel(student: RosterStudent): string {
  if (student.status) {
    const label = student.status === 'present' ? 'حاضر' : student.status === 'absent' ? 'غائب' : 'غائب بعذر'
    return `سجل محفوظ: ${label}`
  }
  if (student.eligibilityReason === 'paused') return 'لا يمكن تسجيل حضور خلال فترة الإيقاف'
  if (student.eligibilityReason === 'before-circle-start') return 'الحلقة لم تبدأ في هذا التاريخ'
  if (student.eligibilityReason === 'after-enrollment-end') return 'التاريخ بعد نهاية الالتحاق'
  if (student.eligibilityReason === 'before-enrollment-start') return 'يتطلب تفعيل الإدخال التاريخي'
  return 'الالتحاق لم يكن نشطًا في هذا التاريخ'
}

export default function TeacherRoster({ roster, slot, endResult, hourlyRate, loading, busy, error, canEarnings, onBack, onSubmit, onDone }: Props) {
  const [marks, setMarks] = useState<Record<string, Status>>({})
  const [query, setQuery] = useState('')
  const [success, setSuccess] = useState<{ present: number; excused: number; absent: number; total: number; queued?: boolean } | null>(null)
  const [suggestions, setSuggestions] = useState<Map<string, { attendedMinutes: number; suggestedStatus: 'present' | 'absent' }>>(new Map())

  useEffect(() => {
    const sid = roster?.sessionId
    if (!sid) { setSuggestions(new Map()); return }
    let active = true
    void roomApi.sessionSuggestedAttendance(sid)
      .then((res) => {
        if (!active) return
        const map = new Map<string, { attendedMinutes: number; suggestedStatus: 'present' | 'absent' }>()
        for (const s of res.students) map.set(s.studentId, { attendedMinutes: s.attendedMinutes, suggestedStatus: s.suggestedStatus })
        setSuggestions(map)
      })
      .catch(() => { if (active) setSuggestions(new Map()) })
    return () => { active = false }
  }, [roster?.sessionId])

  const students = roster?.students ?? []
  const eligibleStudents = useMemo(() => students.filter((student) => student.eligibleForDate), [students])
  const ineligibleStudents = useMemo(() => students.filter((student) => !student.eligibleForDate), [students])

  useEffect(() => {
    if (!roster) return
    const next: Record<string, Status> = {}
    for (const student of roster.students) {
      if (student.eligibleForDate) next[student.enrollmentId] = student.status ?? 'present'
    }
    setMarks(next)
  }, [roster])

  const filtered = useMemo(() => {
    const value = query.trim()
    if (!value) return eligibleStudents
    return eligibleStudents.filter((student) => student.studentName.includes(value) || student.studentCode.includes(value))
  }, [eligibleStudents, query])

  const ineligibleFiltered = useMemo(() => {
    const value = query.trim()
    if (!value) return ineligibleStudents
    return ineligibleStudents.filter((student) => student.studentName.includes(value) || student.studentCode.includes(value))
  }, [ineligibleStudents, query])

  const counts = useMemo(() => {
    let present = 0, excused = 0, absent = 0
    for (const student of eligibleStudents) {
      const status = marks[student.enrollmentId] ?? 'present'
      if (status === 'present') present++
      else if (status === 'excused') excused++
      else absent++
    }
    return { present, excused, absent, total: eligibleStudents.length }
  }, [marks, eligibleStudents])

  const setStudent = (student: RosterStudent, status: Status) => {
    if (!student.eligibleForDate) return
    setMarks((current) => ({ ...current, [student.enrollmentId]: status }))
  }
  const setAll = (status: Status) => {
    const next: Record<string, Status> = {}
    for (const student of eligibleStudents) next[student.enrollmentId] = status
    setMarks(next)
  }
  const applySuggestions = () => {
    setMarks((current) => {
      const next = { ...current }
      for (const student of eligibleStudents) {
        const s = suggestions.get(student.studentId)
        if (s) next[student.enrollmentId] = s.suggestedStatus
      }
      return next
    })
  }

  const submit = async () => {
    try {
      const payload = eligibleStudents.map((student) => ({ enrollmentId: student.enrollmentId, status: marks[student.enrollmentId] ?? 'present' as Status }))
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
        <button onClick={() => setAll('present')} disabled={counts.total === 0}>الكل حاضر</button>
        <button onClick={() => setAll('excused')} disabled={counts.total === 0}>الكل بعذر</button>
        <button onClick={() => setAll('absent')} disabled={counts.total === 0}>الكل غائب</button>
        {suggestions.size > 0 && <button type="button" onClick={applySuggestions}>تطبيق اقتراحات الغرفة</button>}
      </div>

      <div className="t-roster">
        {filtered.map((student) => {
          const status = marks[student.enrollmentId] ?? 'present'
          const suggestion = suggestions.get(student.studentId)
          return (
            <div className="t-student" key={student.enrollmentId}>
              <span className="t-avatar">{student.studentName.slice(0, 1)}</span>
              <div className="t-student-copy">
                <strong>{student.studentName}</strong>
                <small>
                  {student.studentCode} · {enrollmentStatusLabel(student.enrollmentStatus)}
                  {suggestion && ` · ${suggestion.attendedMinutes} د في الغرفة`}
                </small>
              </div>
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

      {ineligibleFiltered.length > 0 && (
        <section className="t-roster t-roster-ineligible" aria-label="طالبات خارج نطاق التسجيل">
          <div className="t-section-label">خارج نطاق التسجيل ({ineligibleFiltered.length})</div>
          {ineligibleFiltered.map((student) => (
            <div className="t-student t-student-disabled" aria-disabled="true" key={student.enrollmentId}>
              <span className="t-avatar">{student.studentName.slice(0, 1)}</span>
              <div className="t-student-copy">
                <strong>{student.studentName}</strong>
                <small>{student.studentCode} · {enrollmentStatusLabel(student.enrollmentStatus)}</small>
                <small className="t-ineligible-reason">{ineligibilityReasonLabel(student)}</small>
              </div>
            </div>
          ))}
        </section>
      )}

      {filtered.length === 0 && ineligibleFiltered.length === 0 && <div className="t-empty">لا توجد نتائج.</div>}
      {error && <p className="t-error">{error}</p>}

      <div className="t-sticky">
        <button className="t-primary" onClick={() => void submit()} disabled={busy || counts.total === 0}>
          <Check size={18} /> {busy ? 'جارٍ التسليم…' : `تسجيل الحضور (${counts.present} · ${counts.excused} · ${counts.absent})`}
        </button>
      </div>

      {success && (
        <div className="t-sheet-backdrop">
          <div className="t-sheet">
            <div className="t-sheet-head">{success.queued ? <WifiOff size={22} /> : <Users size={22} />}<div><strong>{success.queued ? 'تم حفظ الحضور على الجهاز' : 'تم تسجيل الحلقة'}</strong><small>{success.queued ? 'لا يوجد اتصال الآن؛ سيُرسل الحضور تلقائيًا عند عودة الشبكة.' : `${slot?.circleName ?? 'الحلقة'} · تم حفظ الحضور والأجر.`}</small></div></div>
            <div className="t-mini-grid">
              <div><span>حاضر</span><strong>{success.present}</strong></div>
              <div><span>بعذر</span><strong>{success.excused}</strong></div>
              <div><span>غائب</span><strong>{success.absent}</strong></div>
              {canEarnings && !success.queued && <div><span>الأجر</span><strong>{money(amount)}</strong></div>}
              {!success.queued && <div><span>الفعلية</span><strong>{actual} د</strong></div>}
              {!success.queued && <div><span>المحتسبة</span><strong>{payable} د</strong></div>}
            </div>
            {success.queued && <p className="t-note">سيُحسب الأجر والحضور على الخادم بعد الإرسال.</p>}
            {endResult?.message && <p className="t-note">{endResult.message}</p>}
            {endResult?.note && <p className="t-note">ملاحظة الإنهاء: {endResult.note}</p>}
            <button className="t-primary" onClick={onDone}>تم</button>
          </div>
        </div>
      )}
    </div>
  )
}
