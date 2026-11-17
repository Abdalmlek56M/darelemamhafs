import { useEffect, useState } from 'react'
import {
  AlertTriangle, BookOpen, CalendarDays, Clock3, GraduationCap, RefreshCw, UserRound, Users, Wallet,
} from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { SupervisorAbsencesResponse, SupervisorLiveResponse, SupervisorSession, SupervisorUnpaidResponse } from './teacherTypes'
import { money } from './teacherFormat'
import { statusLabel, statusTone, todayCairo } from './supervisorFormat'
import { demoAbsences, demoCircles, demoLive, demoStudents, demoTeachers, demoUnpaid } from './supervisorDemo'

type Section = 'students' | 'circles' | 'teachers' | 'attendance' | 'absences' | 'unpaid'

type Props = {
  demo: boolean
  canStudents: boolean
  canCircles: boolean
  canTeachers: boolean
  canAbsences: boolean
  canUnpaid: boolean
  canFinance: boolean
  canCorrect: boolean
  onNavigate: (section: Section) => void
  onDemo: () => void
}

export default function SupervisorOverview({
  demo, canStudents, canCircles, canTeachers, canAbsences, canUnpaid, canFinance, canCorrect, onNavigate, onDemo,
}: Props) {
  const [live, setLive] = useState<SupervisorLiveResponse | null>(null)
  const [absences, setAbsences] = useState<SupervisorAbsencesResponse | null>(null)
  const [unpaid, setUnpaid] = useState<SupervisorUnpaidResponse | null>(null)
  const [adjusting, setAdjusting] = useState<SupervisorSession | null>(null)
  const [students, setStudents] = useState(0)
  const [circles, setCircles] = useState(0)
  const [teachers, setTeachers] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (demo) {
      setLive(demoLive)
      setAbsences(demoAbsences)
      setUnpaid(canUnpaid ? demoUnpaid : null)
      setStudents(demoStudents.length)
      setCircles(demoCircles.length)
      setTeachers(demoTeachers.length)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [liveData, absenceData, studentData, circleData, teacherData, unpaidData] = await Promise.all([
          canAbsences ? teacherApi.supervisorLive() : Promise.resolve(null),
          canAbsences ? teacherApi.supervisorAbsences() : Promise.resolve(null),
          canStudents ? teacherApi.supervisorStudents() : Promise.resolve(null),
          canCircles ? teacherApi.supervisorCircles() : Promise.resolve(null),
          canTeachers ? teacherApi.supervisorTeachers() : Promise.resolve(null),
          canUnpaid ? teacherApi.supervisorUnpaid() : Promise.resolve(null),
        ])
        if (cancelled) return
        setLive(liveData)
        setAbsences(absenceData)
        setUnpaid(unpaidData)
        setStudents(studentData?.count ?? 0)
        setCircles(circleData?.count ?? 0)
        setTeachers(teacherData?.count ?? 0)
      } catch (err) {
        if (!cancelled) setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل النظرة العامة.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [demo, canAbsences, canStudents, canCircles, canTeachers, canUnpaid, refreshKey])

  const liveSessions = live?.sessions ?? []
  const missingTeachers = absences?.teachers ?? []
  const absentStudents = absences?.students ?? []
  const attention = missingTeachers.length + absentStudents.length

  return (
    <div className="sup-page">
      <div className="sup-page-head">
        <div>
          <span className="sup-eyebrow">{todayCairo()} · نظرة تشغيلية</span>
          <h1>ملخص اليوم</h1>
          <p>كل ما يحدث في الدار اليوم في شاشة واحدة.</p>
        </div>
        <button className="sup-icon-button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading} aria-label="تحديث">
          <RefreshCw size={18} />
        </button>
      </div>

      {error && <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={() => setRefreshKey((value) => value + 1)}>إعادة المحاولة</button></div>}

      <div className="sup-kpi-grid">
        <button className="sup-kpi" onClick={() => canStudents && onNavigate('students')} disabled={!canStudents}>
          <span className="sup-kpi-icon"><UserRound size={18} /></span>
          <span>الطالبات</span>
          <strong>{loading ? '—' : students}</strong>
          <small>داخل نطاقك</small>
        </button>
        <button className="sup-kpi" onClick={() => canCircles && onNavigate('circles')} disabled={!canCircles}>
          <span className="sup-kpi-icon"><BookOpen size={18} /></span>
          <span>الحلقات</span>
          <strong>{loading ? '—' : circles}</strong>
          <small>حلقة نشطة</small>
        </button>
        <button className="sup-kpi" onClick={() => canTeachers && onNavigate('teachers')} disabled={!canTeachers}>
          <span className="sup-kpi-icon"><GraduationCap size={18} /></span>
          <span>المعلمات</span>
          <strong>{loading ? '—' : teachers}</strong>
          <small>معلمة في النطاق</small>
        </button>
        <button className="sup-kpi" onClick={() => canAbsences && onNavigate('attendance')} disabled={!canAbsences}>
          <span className="sup-kpi-icon"><Clock3 size={18} /></span>
          <span>حلقات اليوم</span>
          <strong>{loading ? '—' : liveSessions.length}</strong>
          <small>{liveSessions.filter((item) => item.status === 'in_progress').length} جارية الآن</small>
        </button>
        <button className={`sup-kpi ${attention > 0 ? 'is-warn' : ''}`} onClick={() => canAbsences && onNavigate('absences')} disabled={!canAbsences}>
          <span className="sup-kpi-icon"><AlertTriangle size={18} /></span>
          <span>تحتاج متابعة</span>
          <strong>{loading ? '—' : attention}</strong>
          <small>{missingTeachers.length} معلمة · {absentStudents.length} طالبة</small>
        </button>
        {canUnpaid && (
          <button className="sup-kpi" onClick={() => onNavigate('unpaid')}>
            <span className="sup-kpi-icon"><Wallet size={18} /></span>
            <span>متأخرات</span>
            <strong>{loading ? '—' : unpaid?.count ?? 0}</strong>
            <small>اشتراك مفتوح</small>
          </button>
        )}
      </div>

      {!loading && (students + circles + teachers === 0) && (
        <div className="sup-empty-card">
          <strong>لا توجد بيانات تشغيلية بعد</strong>
          <p>ابدأ بعرض نموذج كامل بالبيانات التجريبية لمعاينة الشكل النهائي، ثم أوقفه للعودة إلى بياناتك الحقيقية.</p>
          <button className="sup-primary" onClick={onDemo}>عرض نموذج بالبيانات</button>
        </div>
      )}

      <div className="sup-two-col">
        <section className="sup-panel">
          <div className="sup-panel-head">
            <div><h2>الحلقات الآن</h2><span>{liveSessions.length} حلقة</span></div>
            {canAbsences && <button className="sup-text-button" onClick={() => onNavigate('attendance')}>عرض الحضور</button>}
          </div>
          {liveSessions.length === 0 && <p className="sup-muted">{loading ? 'جارٍ التحميل…' : 'لا توجد حلقات جارية الآن.'}</p>}
          <div className="sup-list">
            {liveSessions.map((session) => (
              <div className="sup-row" key={session.sessionId}>
                <span className={`sup-dot ${session.status === 'in_progress' ? 'is-live' : ''}`} />
                <div className="sup-row-copy">
                  <strong>{session.circleName}</strong>
                  <small>{session.teacherName} · {session.scheduledStart} · {session.studentCount} طالبة</small>
                </div>
                <span className={statusTone(session.status)}>{statusLabel(session.status)}</span>
                {canFinance && session.payableAmount !== null && <span className="sup-chip">{money(session.payableAmount)}</span>}
                {canCorrect && session.attendanceId && <button className="sup-text-button" onClick={() => setAdjusting(session)}>تعديل الوقت</button>}
              </div>
            ))}
          </div>
        </section>

        <section className="sup-panel">
          <div className="sup-panel-head">
            <div><h2>تحتاج متابعة</h2><span>{attention} عنصر</span></div>
            {canAbsences && <button className="sup-text-button" onClick={() => onNavigate('absences')}>فتح الغياب</button>}
          </div>
          {attention === 0 && <p className="sup-muted">{loading ? 'جارٍ التحميل…' : 'لا توجد متابعات مفتوحة. كل شيء مضبوط.'}</p>}
          <div className="sup-list">
            {missingTeachers.slice(0, 3).map((item) => (
              <div className="sup-row" key={`${item.scheduleSlotId}-${item.startsAt}`}>
                <span className="sup-kpi-icon is-warn"><AlertTriangle size={15} /></span>
                <div className="sup-row-copy">
                  <strong>{item.teacherName}</strong>
                  <small>{item.circleName} · {item.startsAt} · لم تسجل الحضور</small>
                </div>
                <span className="t-badge t-badge-bad">معلمة</span>
              </div>
            ))}
            {absentStudents.slice(0, 3).map((item) => (
              <div className="sup-row" key={item.attendanceId}>
                <span className="sup-kpi-icon"><Users size={15} /></span>
                <div className="sup-row-copy">
                  <strong>{item.studentName}</strong>
                  <small>{item.circleName} · {item.status === 'excused' ? 'بعذر' : 'بدون عذر'}</small>
                </div>
                <span className={`t-badge ${item.status === 'excused' ? 't-badge-gold' : 't-badge-bad'}`}>{statusLabel(item.status)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="sup-quick-grid">
        {canStudents && <button className="sup-quick" onClick={() => onNavigate('students')}><UserRound size={18} /><strong>الطالبات</strong><small>ملفات، حضور، وملاحظات</small></button>}
        {canCircles && <button className="sup-quick" onClick={() => onNavigate('circles')}><BookOpen size={18} /><strong>الحلقات</strong><small>كشوف ومواعيد وسجل حصص</small></button>}
        {canTeachers && <button className="sup-quick" onClick={() => onNavigate('teachers')}><GraduationCap size={18} /><strong>المعلمات</strong><small>نسب الحضور والساعات</small></button>}
        {canAbsences && <button className="sup-quick" onClick={() => onNavigate('absences')}><CalendarDays size={18} /><strong>الغياب</strong><small>معلمات وطالبات اليوم</small></button>}
      </div>

      <p className="sup-footnote">كل الأوقات بتوقيت القاهرة. الأجور لا تظهر بدون صلاحية المالية.</p>

      {adjusting && (
        <AdjustSheet
          session={adjusting}
          canFinance={canFinance}
          onClose={() => setAdjusting(null)}
          onSaved={() => { setAdjusting(null); setRefreshKey((value) => value + 1) }}
        />
      )}
    </div>
  )
}

function AdjustSheet({ session, canFinance, onClose, onSaved }: { session: SupervisorSession; canFinance: boolean; onClose: () => void; onSaved: () => void }) {
  const [minutes, setMinutes] = useState(String(session.payableMinutes ?? session.actualMinutes))
  const [amount, setAmount] = useState(session.payableAmount === null ? '' : String(session.payableAmount))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await teacherApi.adjustAttendance(
        session.attendanceId!,
        Number(minutes),
        canFinance && amount.trim() ? Number(amount) : null,
        note.trim(),
      )
      onSaved()
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر حفظ التعديل.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="t-sheet-backdrop" onClick={() => !busy && onClose()}>
      <div className="t-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="t-sheet-head"><AlertTriangle size={22} /><div><strong>{canFinance ? 'تعديل الوقت والأجر' : 'تعديل الوقت'}</strong><small>{session.circleName} · {session.teacherName}</small></div></div>
        <label className="t-label">المدة المحتسبة (دقيقة)</label>
        <input className="t-input" type="number" min={1} max={360} value={minutes} onChange={(event) => setMinutes(event.target.value)} />
        {canFinance && <label className="t-label">الأجر (اتركيه فارغًا للحساب التلقائي)</label>}
        {canFinance && <input className="t-input" type="number" min={0} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />}
        <label className="t-label">سبب التعديل</label>
        <textarea className="t-textarea" rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="مثال: المعلمة أرسلت دليلًا على وقت إضافي معتمد." />
        {error && <p className="t-error">{error}</p>}
        <div className="t-sheet-actions">
          <button className="t-primary" onClick={() => void save()} disabled={busy || !note.trim()}>حفظ التعديل</button>
          <button className="t-secondary" onClick={onClose} disabled={busy}>إلغاء</button>
        </div>
      </div>
    </div>
  )
}
