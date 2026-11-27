import { formatTime12 } from '../lib/dates'
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Clock3, Square } from 'lucide-react'
import type { Slot } from './teacherTypes'
import { localTime, money, timeRange } from './teacherFormat'
import { teacherLivePayableMinutes } from './teacherLivePay'

type Props = {
  slot: Slot | null
  sessionId: string
  hourlyRate: number
  scheduledMinutes: number
  startedAt: string | null
  busy: boolean
  error: string | null
  canEarnings: boolean
  onBack: () => void
  onEnd: (note: string) => Promise<void>
}

function clock(startedAt: string | null) {
  if (!startedAt) return '00:00'
  const total = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export default function TeacherLive({ slot, hourlyRate, scheduledMinutes, startedAt, busy, error, canEarnings, onBack, onEnd }: Props) {
  const [tick, setTick] = useState(0)
  const [finishOpen, setFinishOpen] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const actual = useMemo(() => {
    if (!startedAt) return 0
    return Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000))
  }, [startedAt, tick])

  const payable = teacherLivePayableMinutes(scheduledMinutes, actual)
  const amount = payable * hourlyRate / 60
  const overtime = Math.max(0, actual - scheduledMinutes)
  const undertime = Math.max(0, scheduledMinutes - actual)
  const timer = clock(startedAt)

  const confirm = async () => {
    try {
      await onEnd(note.trim())
      setFinishOpen(false)
    } catch { /* the parent shows the error */ }
  }

  return (
    <div className="t-page">
      <header className="t-subheader">
        <button className="t-icon-button" aria-label="رجوع" onClick={onBack}><ArrowRight size={20} /></button>
        <div><span className="t-eyebrow">{slot?.circleName ?? 'الحلقة'}</span><h1>الحلقة الجارية</h1></div>
      </header>

      <div className="t-timer-card">
        <span className="t-badge t-badge-live">مباشر</span>
        <div className="t-timer">{timer}</div>
        <p className="t-muted">{slot ? timeRange(slot.startsAt, slot.endsAt) : `المدة الأساسية ${scheduledMinutes} دقيقة`}</p>
        <div className="t-chip-row">
          {startedAt && <span className="t-chip">بدأت {localTime(startedAt)}</span>}
          {overtime > 0 && <span className="t-chip t-chip-warn">بعد الموعد +{overtime} د</span>}
          {undertime > 0 && <span className="t-chip">المتبقي {undertime} د</span>}
        </div>
      </div>

      {canEarnings && (
        <div className="t-pay-banner">
          <span>الأجر المتوقع</span>
          <strong>{money(amount)}</strong>
          <small>{actual} فعلية · {payable} محتسبة · {hourlyRate} ج.م/ساعة</small>
        </div>
      )}

      {canEarnings && <p className="t-hint">إذا تجاوزتِ المدة الأساسية يُحتسب الأجر على المدة الأساسية، والزيادة تُسجل للمراجعة. إذا انتهيتِ مبكرًا يُحتسب الوقت الفعلي.</p>}

      <button className="t-primary t-danger" onClick={() => setFinishOpen(true)} disabled={busy}>
        <Square size={17} /> إنهاء الحلقة
      </button>
      {error && <p className="t-error">{error}</p>}

      {finishOpen && (
        <div className="t-sheet-backdrop" onClick={() => !busy && setFinishOpen(false)}>
          <div className="t-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="t-sheet-head"><Clock3 size={22} /><div><strong>إنهاء الحلقة</strong><small>راجعي الوقت وأضيفي ملاحظة قبل فتح قائمة الطالبات.</small></div></div>
            <div className="t-mini-grid">
              <div><span>الفعلية</span><strong>{actual} د</strong></div>
              <div><span>الأساسية</span><strong>{scheduledMinutes} د</strong></div>
              <div><span>المحتسبة</span><strong>{payable} د</strong></div>
              <div><span>بعد الموعد</span><strong>{overtime} د</strong></div>
            </div>
            {canEarnings && <div className="t-pay-banner compact"><span>الأجر المحتسب</span><strong>{money(amount)}</strong></div>}
            <label className="t-label" htmlFor="finish-note">ملاحظة الإنهاء — وقت إضافي / انتهاء مبكر / تفصيل</label>
            <textarea id="finish-note" className="t-textarea" rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="مثال: انتظرنا وصول الطالبات، أو استكملنا مراجعة الجزء." />
            <div className="t-sheet-actions">
              <button className="t-primary" onClick={() => void confirm()} disabled={busy}>{busy ? 'جارٍ الإنهاء…' : 'تأكيد الإنهاء وتسجيل الطلاب'}</button>
              <button className="t-secondary" onClick={() => setFinishOpen(false)} disabled={busy}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
