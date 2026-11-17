import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, RefreshCw, Users } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { SupervisorStudentAttendanceRow, SupervisorTeacherAttendanceRow } from './teacherTypes'
import { dateLabel, statusLabel, statusTone, todayCairo } from './supervisorFormat'

type Tab = 'teachers' | 'students'

export default function SupervisorAttendance() {
  const [date, setDate] = useState(todayCairo())
  const [tab, setTab] = useState<Tab>('teachers')
  const [teachers, setTeachers] = useState<SupervisorTeacherAttendanceRow[]>([])
  const [students, setStudents] = useState<SupervisorStudentAttendanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (day: string) => {
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
  }, [])

  useEffect(() => { void load(date) }, [date, load])

  const teacherPresent = teachers.filter((row) => row.status === 'present').length
  const teacherMissing = teachers.filter((row) => row.status === 'missing').length
  const studentPresent = students.filter((row) => row.status === 'present').length
  const studentAbsent = students.filter((row) => row.status === 'absent').length
  const studentExcused = students.filter((row) => row.status === 'excused').length

  return (
    <div className="t-page t-page-embedded">
      <header className="t-subheader">
        <div><span className="t-eyebrow">الإشراف</span><h1>الحضور</h1></div>
        <button className="t-icon-button" aria-label="تحديث" onClick={() => void load(date)}><RefreshCw size={18} /></button>
      </header>

      <div className="t-date-row">
        <CalendarDays size={16} />
        <input
          className="t-input"
          type="date"
          value={date}
          max={todayCairo()}
          onChange={(event) => setDate(event.target.value || todayCairo())}
          aria-label="تاريخ الحضور"
        />
        <span className="t-muted">{dateLabel(date)}</span>
      </div>

      <div className="t-filter-row">
        <button className={`t-filter ${tab === 'teachers' ? 'active' : ''}`} onClick={() => setTab('teachers')}>
          المعلمات ({teachers.length})
        </button>
        <button className={`t-filter ${tab === 'students' ? 'active' : ''}`} onClick={() => setTab('students')}>
          الطالبات ({students.length})
        </button>
      </div>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => void load(date)}>إعادة المحاولة</button></div>}

      {tab === 'teachers' && (
        <>
          <div className="t-mini-grid t-mini-grid-three">
            <div><span>حاضرات</span><strong>{teacherPresent}</strong></div>
            <div><span>لم تسجل</span><strong>{teacherMissing}</strong></div>
            <div><span>إجمالي الحصص</span><strong>{teachers.length}</strong></div>
          </div>
          {loading && teachers.length === 0 && <div className="t-empty">جارٍ تحميل حضور المعلمات…</div>}
          {!loading && teachers.length === 0 && <div className="t-empty">لا توجد حصص مجدولة في هذا اليوم.</div>}
          <div className="t-list">
            {teachers.map((row) => (
              <div className="t-row" key={row.scheduleSlotId}>
                <div className="t-row-copy">
                  <strong>{row.teacherName}</strong>
                  <small>{row.circleName} · {row.startsAt} · {row.durationMinutes} دقيقة</small>
                  {row.note && <small>{row.note}</small>}
                </div>
                <div className="t-row-actions">
                  <span className={statusTone(row.status)}>{statusLabel(row.status)}</span>
                  {row.status === 'present' && row.overtimeMinutes > 0 && <span className="t-chip t-chip-warn">+{row.overtimeMinutes} د</span>}
                  {row.status === 'present' && row.undertimeMinutes > 0 && <span className="t-chip">نقص {row.undertimeMinutes} د</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'students' && (
        <>
          <div className="t-mini-grid t-mini-grid-four">
            <div><span>حاضرات</span><strong>{studentPresent}</strong></div>
            <div><span>غائبات</span><strong>{studentAbsent}</strong></div>
            <div><span>بعذر</span><strong>{studentExcused}</strong></div>
            <div><span>إجمالي السجلات</span><strong>{students.length}</strong></div>
          </div>
          {loading && students.length === 0 && <div className="t-empty">جارٍ تحميل حضور الطالبات…</div>}
          {!loading && students.length === 0 && <div className="t-empty">لا يوجد حضور مسجل في هذا اليوم.</div>}
          <div className="t-list">
            {students.map((row) => (
              <div className="t-row" key={row.attendanceId}>
                <span className="t-avatar"><Users size={14} /></span>
                <div className="t-row-copy">
                  <strong>{row.studentName}</strong>
                  <small>{row.circleName} · {row.startsAt} · {row.studentCode}</small>
                  {row.note && <small>{row.note}</small>}
                </div>
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

