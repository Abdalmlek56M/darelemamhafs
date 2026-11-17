import { useEffect, useState } from 'react'
import { AlertTriangle, Clock3, LogOut, Phone, RefreshCw, Wallet } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type {
  SupervisorAbsencesResponse, SupervisorLiveResponse, SupervisorSession, SupervisorUnpaidResponse,
} from './teacherTypes'
import { money } from './teacherFormat'
import SupervisorStudents from './SupervisorStudents'
import SupervisorTeachers from './SupervisorTeachers'
import SupervisorCircles from './SupervisorCircles'
import SupervisorAttendance from './SupervisorAttendance'

type Props = {
  canCorrect: boolean
  canUnpaid: boolean
  canFinance: boolean
  canLive: boolean
  canAbsences: boolean
  canStudents: boolean
  canStudentsNotes: boolean
  canCircles: boolean
  canTeachers: boolean
  canTeacherNotes: boolean
  onLogout: () => void
}

type Tab = 'live' | 'absences' | 'students' | 'circles' | 'teachers' | 'attendance' | 'unpaid'

export default function SupervisorBoard(props: Props) {
  const { canCorrect, canUnpaid, canFinance, canLive, canAbsences, canStudents, canCircles, canTeachers, onLogout } = props
  const firstTab: Tab = canLive ? 'live' : canAbsences ? 'absences' : canStudents ? 'students'
    : canCircles ? 'circles' : canTeachers ? 'teachers' : canUnpaid ? 'unpaid' : 'live'
  const [tab, setTab] = useState<Tab>(firstTab)
  const [live, setLive] = useState<SupervisorLiveResponse | null>(null)
  const [absences, setAbsences] = useState<SupervisorAbsencesResponse | null>(null)
  const [unpaid, setUnpaid] = useState<SupervisorUnpaidResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState<SupervisorSession | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [liveData, absenceData, unpaidData] = await Promise.all([
        canLive ? teacherApi.supervisorLive() : Promise.resolve(null),
        canAbsences ? teacherApi.supervisorAbsences() : Promise.resolve(null),
        canUnpaid ? teacherApi.supervisorUnpaid() : Promise.resolve(null),
      ])
      setLive(liveData)
      setAbsences(absenceData)
      setUnpaid(unpaidData)
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تحميل لوحة المشرفة.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [canLive, canAbsences, canUnpaid])
  useEffect(() => {
    const allowed = tab === 'live' ? canLive
      : tab === 'absences' || tab === 'attendance' ? canAbsences
        : tab === 'students' ? canStudents
          : tab === 'circles' ? canCircles
            : tab === 'teachers' ? canTeachers
              : canUnpaid
    if (!allowed) setTab(firstTab)
  }, [tab, canLive, canAbsences, canStudents, canCircles, canTeachers, canUnpaid, firstTab])

  const isOverview = tab === 'live' || tab === 'absences' || tab === 'unpaid'
  const studentAbsences = absences?.students ?? []
  const teacherAbsences = absences?.teachers ?? []

  return (
    <div className="t-page">
      {isOverview && (
        <header className="t-subheader">
          <span className="t-icon-button"><Clock3 size={20} /></span>
          <div><span className="t-eyebrow">متابعة تشغيلية</span><h1>لوحة المشرفة</h1></div>
          <div className="t-header-actions">
            <button className="t-icon-button" aria-label="تحديث" onClick={() => void load()} disabled={loading}><RefreshCw size={18} /></button>
            <button className="t-icon-button" aria-label="تسجيل الخروج" onClick={onLogout}><LogOut size={18} /></button>
          </div>
        </header>
      )}

      <div className="t-filter-row">
        {canLive && <button className={`t-filter ${tab === 'live' ? 'active' : ''}`} onClick={() => setTab('live')}>الآن ({live?.sessions.length ?? 0})</button>}
        {canAbsences && <button className={`t-filter ${tab === 'absences' ? 'active' : ''}`} onClick={() => setTab('absences')}>الغياب ({studentAbsences.length + teacherAbsences.length})</button>}
        {canStudents && <button className={`t-filter ${tab === 'students' ? 'active' : ''}`} onClick={() => setTab('students')}>الطالبات</button>}
        {canCircles && <button className={`t-filter ${tab === 'circles' ? 'active' : ''}`} onClick={() => setTab('circles')}>الحلقات</button>}
        {canTeachers && <button className={`t-filter ${tab === 'teachers' ? 'active' : ''}`} onClick={() => setTab('teachers')}>المعلمات</button>}
        {canAbsences && <button className={`t-filter ${tab === 'attendance' ? 'active' : ''}`} onClick={() => setTab('attendance')}>الحضور</button>}
        {canUnpaid && <button className={`t-filter ${tab === 'unpaid' ? 'active' : ''}`} onClick={() => setTab('unpaid')}>المتأخرات ({unpaid?.count ?? 0})</button>}
      </div>

      {isOverview && loading && !live && !absences && <div className="t-empty">جارٍ تحميل اللوحة…</div>}
      {isOverview && error && <p className="t-error">{error}</p>}

      {tab === 'live' && canLive && (
        <div className="t-list">
          {live?.sessions.length === 0 && !loading && <div className="t-empty">لا توجد حلقات جارية الآن.</div>}
          {live?.sessions.map((session) => (
            <article className="t-supervisor-card" key={session.sessionId}>
              <div className="t-notification-head"><strong>{session.circleName}</strong><span className={`t-badge ${session.status === 'in_progress' ? 't-badge-live' : 't-badge-gold'}`}>{session.status === 'in_progress' ? 'مباشر' : 'بانتظار الحضور'}</span></div>
              <p className="t-muted">{session.teacherName} · {session.scheduledStart} · {session.studentCount} طالبة</p>
              <div className="t-chip-row">
                <span className="t-chip">{session.actualMinutes} دقيقة</span>
                {session.lateMinutes > 0 && <span className="t-chip t-chip-warn">تأخر {session.lateMinutes} د</span>}
                {session.overtimeMinutes > 0 && <span className="t-chip t-chip-warn">الوقت + {session.overtimeMinutes} د</span>}
                {canFinance && session.payableAmount !== null && <span className="t-chip t-chip-ok">أجر {money(session.payableAmount)}</span>}
              </div>
              {session.note && <p className="t-note">ملاحظة المعلمة: {session.note}</p>}
              {canCorrect && session.attendanceId && (
                <button className="t-secondary t-full" onClick={() => setAdjusting(session)}>تعديل الوقت{canFinance ? '/الأجر' : ''}</button>
              )}
            </article>
          ))}
        </div>
      )}

      {tab === 'absences' && canAbsences && (
        <>
          <div className="t-section-title"><strong>معلمات لم يسجلن</strong><span>{teacherAbsences.length}</span></div>
          <div className="t-list">
            {teacherAbsences.length === 0 && !loading && <div className="t-empty">لا توجد معلمات متأخرات عن التسجيل.</div>}
            {teacherAbsences.map((item) => (
              <article className="t-supervisor-card" key={`${item.scheduleSlotId}-${item.startsAt}`}>
                <div className="t-notification-head"><strong>{item.teacherName}</strong><span className="t-badge t-badge-bad">لم تسجل</span></div>
                <p className="t-muted">{item.circleName} · {item.startsAt} · {item.durationMinutes} دقيقة</p>
                {item.phone && <p className="t-row-meta" dir="ltr"><Phone size={11} /> {item.phone}</p>}
              </article>
            ))}
          </div>

          <div className="t-section-title"><strong>طالبات غائبات</strong><span>{studentAbsences.length}</span></div>
          <div className="t-list">
            {studentAbsences.length === 0 && !loading && <div className="t-empty">لا يوجد غياب مسجل اليوم.</div>}
            {studentAbsences.map((item) => (
              <article className="t-supervisor-card" key={item.attendanceId}>
                <div className="t-notification-head"><strong>{item.studentName}</strong><span className={`t-badge ${item.status === 'excused' ? 't-badge-gold' : 't-badge-bad'}`}>{item.status === 'excused' ? 'بعذر' : 'بدون عذر'}</span></div>
                <p className="t-muted">{item.circleName} · {item.teacherName} · {item.studentCode}</p>
                {item.note && <p className="t-note">{item.note}</p>}
              </article>
            ))}
          </div>
        </>
      )}

      {tab === 'unpaid' && canUnpaid && (
        <div className="t-list">
          <p className="t-hint">تبقى هذه التنبيهات مفتوحة حتى سداد الاشتراك بالكامل. لا تعرض هذه الشاشة إيصالات أو حركات مالية.</p>
          {unpaid?.unpaid.length === 0 && !loading && <div className="t-empty">لا توجد متأخرات مستحقة الآن.</div>}
          {unpaid?.unpaid.map((item) => (
            <article className="t-supervisor-card" key={item.chargeId}>
              <div className="t-notification-head"><strong>{item.studentName}</strong><span className="t-badge t-badge-gold">مفتوح</span></div>
              <p className="t-muted">{item.circleName} · {item.teacherName}</p>
              <div className="t-supervisor-total"><Wallet size={16} /><span>المتبقي</span><strong>{money(item.balance)}</strong><small>من {money(item.amountDue)}</small></div>
            </article>
          ))}
        </div>
      )}

      {tab === 'students' && canStudents && <SupervisorStudents canNote={props.canStudentsNotes} />}
      {tab === 'circles' && canCircles && <SupervisorCircles />}
      {tab === 'teachers' && canTeachers && <SupervisorTeachers canNote={props.canTeacherNotes} />}
      {tab === 'attendance' && canAbsences && <SupervisorAttendance />}

      {adjusting && <AdjustSheet session={adjusting} canFinance={canFinance} onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); void load() }} />}
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
