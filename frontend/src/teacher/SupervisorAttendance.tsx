import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, Users } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { SupervisorStudentAttendanceRow, SupervisorTeacherAttendanceRow } from './teacherTypes'
import { dateLabel, statusLabel, statusTone, todayCairo } from './supervisorFormat'
import { demoStudentAttendance, demoTeacherAttendance } from './supervisorDemo'

type Tab = 'teachers' | 'students'
type Props = { demo?: boolean; onOpenTeacher?: (id: string) => void; onOpenCircle?: (id: string) => void }

export default function SupervisorAttendance({ demo = false, onOpenTeacher, onOpenCircle }: Props) {
  const [date, setDate] = useState(todayCairo())
  const [tab, setTab] = useState<Tab>('teachers')
  const [teachers, setTeachers] = useState<SupervisorTeacherAttendanceRow[]>([])
  const [students, setStudents] = useState<SupervisorStudentAttendanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (day: string) => {
    if (demo) {
      setTeachers(demoTeacherAttendance)
      setStudents(demoStudentAttendance)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [teacherData, studentData] = await Promise.all([
        teacherApi.supervisorTeacherAttendance(day),
        teacherApi.supervisorStudentAttendance(day),
      ])
      setTeachers(teacherData.sessions)
      setStudents(studentData.attendance)
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل الحضور.')
    } finally {
      setLoading(false)
    }
  }, [demo])

  useEffect(() => { void load(date) }, [date, load])

  const teacherPresent = teachers.filter((row) => row.status === 'present').length
  const teacherMissing = teachers.filter((row) => row.status === 'missing').length
  const studentPresent = students.filter((row) => row.status === 'present').length
  const studentAbsent = students.filter((row) => row.status === 'absent').length
  const studentExcused = students.filter((row) => row.status === 'excused').length

  return (
    <div className="t-page t-page-embedded">
      <div className="sup-toolbar">
        <label className="sup-date"><CalendarDays size={16} /><input type="date" value={date} max={todayCairo()} onChange={(event) => setDate(event.target.value || todayCairo())} aria-label="تاريخ الحضور" /><span>{dateLabel(date)}</span></label>
        <div className="sup-segment">
          <button className={tab === 'teachers' ? 'active' : ''} onClick={() => setTab('teachers')}>المعلمات ({teachers.length})</button>
          <button className={tab === 'students' ? 'active' : ''} onClick={() => setTab('students')}>الطالبات ({students.length})</button>
        </div>
      </div>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load(date)}>إعادة المحاولة</button></div>}

      {tab === 'teachers' && (
        <>
          <div className="sup-kpi-grid sup-kpi-grid-three">
            <div className="sup-kpi"><span className="sup-kpi-icon"><Users size={18} /></span><span>حاضرات</span><strong>{teacherPresent}</strong><small>من {teachers.length}</small></div>
            <div className="sup-kpi"><span className="sup-kpi-icon is-warn"><Users size={18} /></span><span>لم تسجل</span><strong>{teacherMissing}</strong><small>تحتاج متابعة</small></div>
            <div className="sup-kpi"><span className="sup-kpi-icon"><CalendarDays size={18} /></span><span>إجمالي الحصص</span><strong>{teachers.length}</strong><small>{dateLabel(date)}</small></div>
          </div>
          {loading && teachers.length === 0 && <div className="t-empty">جارٍ تحميل حضور المعلمات…</div>}
          <div className="sup-table-wrap">
            <table className="sup-table">
              <thead><tr><th>المعلمة</th><th>الحلقة</th><th>الوقت</th><th>المدة</th><th>الحالة</th><th>الملاحظة</th></tr></thead>
              <tbody>
                {teachers.map((row) => (
                  <tr key={row.scheduleSlotId}>
                    <td><button className="sup-link" onClick={() => onOpenTeacher?.(row.teacherId)}>{row.teacherName}</button></td>
                    <td><button className="sup-link" onClick={() => onOpenCircle?.(row.circleId)}>{row.circleName}</button></td>
                    <td>{row.startsAt}</td>
                    <td>{row.durationMinutes} د</td>
                    <td><span className={statusTone(row.status)}>{statusLabel(row.status)}</span></td>
                    <td>{row.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sup-card-list">
            {teachers.map((row) => (
              <div className="sup-card" key={row.scheduleSlotId}>
                <div className="sup-row-copy"><strong>{row.teacherName}</strong><small>{row.circleName} · {row.startsAt} · {row.durationMinutes} دقيقة</small>{row.note && <small>{row.note}</small>}</div>
                <span className={statusTone(row.status)}>{statusLabel(row.status)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'students' && (
        <>
          <div className="sup-kpi-grid sup-kpi-grid-three">
            <div className="sup-kpi"><span className="sup-kpi-icon"><Users size={18} /></span><span>حاضرات</span><strong>{studentPresent}</strong><small>من {students.length}</small></div>
            <div className="sup-kpi"><span className="sup-kpi-icon is-warn"><Users size={18} /></span><span>غائبات</span><strong>{studentAbsent}</strong><small>بدون عذر</small></div>
            <div className="sup-kpi"><span className="sup-kpi-icon"><CalendarDays size={18} /></span><span>بعذر</span><strong>{studentExcused}</strong><small>{dateLabel(date)}</small></div>
          </div>
          {loading && students.length === 0 && <div className="t-empty">جارٍ تحميل حضور الطالبات…</div>}
          <div className="sup-table-wrap">
            <table className="sup-table">
              <thead><tr><th>الطالبة</th><th>الكود</th><th>الحلقة</th><th>الوقت</th><th>الحالة</th><th>الملاحظة</th></tr></thead>
              <tbody>
                {students.map((row) => (
                  <tr key={row.attendanceId}>
                    <td><span className="sup-person"><span className="sup-person-avatar">{row.studentName.slice(0, 1)}</span><strong>{row.studentName}</strong></span></td>
                    <td dir="ltr">{row.studentCode}</td>
                    <td><button className="sup-link" onClick={() => onOpenCircle?.(row.circleId)}>{row.circleName}</button></td>
                    <td>{row.startsAt}</td>
                    <td><span className={statusTone(row.status)}>{statusLabel(row.status)}</span></td>
                    <td>{row.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sup-card-list">
            {students.map((row) => (
              <div className="sup-card" key={row.attendanceId}>
                <div className="sup-row-copy"><strong>{row.studentName}</strong><small>{row.circleName} · {row.startsAt} · {row.studentCode}</small>{row.note && <small>{row.note}</small>}</div>
                <span className={statusTone(row.status)}>{statusLabel(row.status)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="t-footnote">الحضور المعروض داخل نطاقك فقط. الأجور لا تظهر بدون صلاحية المالية.</p>
    </div>
  )
}
