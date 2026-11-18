import { Bell, CalendarDays, History, LogOut, Play, Users, Wallet } from 'lucide-react'
import type { EarningsResponse, Slot, TodayResponse } from './teacherTypes'
import { formatTime12 } from '../lib/dates'
import { localDate, money, timeRange } from './teacherFormat'

type Props = {
  today: TodayResponse | null
  earnings: EarningsResponse | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  onStart: (slot: Slot) => void
  onOpenLive: (sessionId: string) => void
  onOpenRoster: (sessionId: string) => void
  onNotifications: () => void
  onSubscriptions: () => void
  onCalendar: () => void
  onHistory: () => void
  onLogout: () => void
  canSubscriptions: boolean
  canEarnings: boolean
  unread: number
  canRequests: boolean
  onRequests: () => void
}

function SlotStatus({ slot }: { slot: Slot }) {
  if (slot.sessionStatus === 'in_progress') return <span className="t-badge t-badge-live">جارية الآن</span>
  if (slot.sessionStatus === 'awaiting_attendance') return <span className="t-badge t-badge-gold">بانتظار الحضور</span>
  if (slot.sessionStatus === 'completed') return <span className="t-badge t-badge-ok">تم تسجيلها</span>
  if (slot.isCurrent) return <span className="t-badge t-badge-live">وقت الحلقة</span>
  if (slot.isNext) return <span className="t-badge">القادمة</span>
  return <span className="t-badge t-badge-muted">لم تبدأ</span>
}

function SlotAction({ slot, onStart, onOpenLive, onOpenRoster }: Pick<Props, 'onStart' | 'onOpenLive' | 'onOpenRoster'> & { slot: Slot }) {
  if (slot.sessionId && slot.sessionStatus === 'in_progress') {
    return <button className="t-primary" onClick={() => onOpenLive(slot.sessionId!)}><Play size={17} /> فتح الحلقة الجارية</button>
  }
  if (slot.sessionId && slot.sessionStatus === 'awaiting_attendance') {
    return <button className="t-primary" onClick={() => onOpenRoster(slot.sessionId!)}><Users size={17} /> إكمال حضور الطالبات</button>
  }
  if (slot.sessionStatus === 'completed') {
    return <button className="t-secondary" disabled>تم تسجيل الحلقة</button>
  }
  if (!slot.canStart) {
    return <button className="t-secondary" disabled>تبدأ {formatTime12(slot.startsAt)}</button>
  }
  return <button className="t-primary" onClick={() => onStart(slot)}><Play size={17} /> تسجيل الحضور</button>
}

export default function TeacherHome({
  today, earnings, loading, error, onRefresh, onStart, onOpenLive, onOpenRoster,
  onNotifications, onSubscriptions, onCalendar, onHistory, onLogout, canSubscriptions, canEarnings, unread, canRequests, onRequests,
}: Props) {
  if (loading && !today) return <div className="t-empty">جارٍ تحميل حلقاتك…</div>
  if (error) return <div className="t-error-card"><p>{error}</p><button className="t-secondary" onClick={onRefresh}>إعادة المحاولة</button></div>

  const slots = today?.slots ?? []
  const current = slots.find((slot) => slot.isCurrent || slot.sessionStatus === 'in_progress')
    ?? slots.find((slot) => slot.sessionStatus === 'awaiting_attendance')
    ?? slots.find((slot) => slot.isNext)
    ?? [...slots].reverse().find((slot) => !slot.sessionId && slot.sessionStatus !== 'completed')
  const rest = slots.filter((slot) => slot.id !== current?.id)
  const restTitle = current?.isCurrent || current?.isNext ? 'باقي اليوم' : 'حلقات أخرى اليوم'
  const sessionsLabel = (count: number) => count === 1 ? 'حلقة واحدة' : `${count} حلقات`
  const name = today?.teacher.name ?? ''

  return (
    <div className="t-page">
      <header className="t-header">
        <div>
          <span className="t-eyebrow">{today ? localDate(today.date) : 'اليوم'}</span>
          <h1>السلام عليكِ، {name || 'أستاذة'}</h1>
          <p className="t-muted">حلقاتك اليوم — كل شيء في مكان واحد.</p>
        </div>
        <div className="t-header-actions">
          <button className="t-icon-button" aria-label="التنبيهات" onClick={onNotifications}><Bell size={20} /></button>
          <button className="t-icon-button" aria-label="تسجيل الخروج" onClick={onLogout}><LogOut size={18} /></button>
        </div>
      </header>

      <div className="t-home-grid">
      {slots.length === 0 && <div className="t-empty">لا توجد حلقات مجدولة اليوم.</div>}
      {slots.length > 0 && !current && <div className="t-empty">انتهت حلقات اليوم.</div>}

      {current && (
        <article className="t-live-card">
          <div className="t-live-head"><SlotStatus slot={current} /></div>
          <h2>{current.circleName}</h2>
          <p className="t-muted">{timeRange(current.startsAt, current.endsAt)} · {current.studentCount} طالبة</p>
          <div className="t-chip-row">
            {current.lateMinutes > 0 && <span className="t-chip t-chip-warn">بدأت متأخرة {current.lateMinutes} د</span>}
            {current.overtimeMinutes > 0 && <span className="t-chip t-chip-warn">الوقت + {current.overtimeMinutes} د</span>}
            {current.undertimeMinutes > 0 && <span className="t-chip">انتهت قبل الموعد {current.undertimeMinutes} د</span>}
          </div>
          <SlotAction slot={current} onStart={onStart} onOpenLive={onOpenLive} onOpenRoster={onOpenRoster} />
        </article>
      )}

      <div className="t-stat-grid" style={{ gridTemplateColumns: canEarnings ? undefined : '1fr' }}>
        {canEarnings && (
          <div className="t-stat">
            <Wallet size={18} />
            <span>مستحق الشهر</span>
            <strong>{money(earnings?.totals.payable)}</strong>
            <small>{earnings?.totals.sessions ?? 0} حلقة · {earnings?.totals.minutes ?? 0} دقيقة</small>
          </div>
        )}
        <div className="t-stat">
          <CalendarDays size={18} />
          <span>حلقات اليوم</span>
          <strong>{slots.length}</strong>
          <small>{slots.filter((slot) => slot.sessionStatus === 'completed').length} مكتملة</small>
        </div>
      </div>

      {canSubscriptions && (
        <button className="t-link-card" onClick={onSubscriptions}>
          <span><Wallet size={18} /> اشتراكات طالباتي</span>
          <small>حالة السداد والمتبقي — بدون تفاصيل مالية إدارية.</small>
        </button>
      )}

      <div className="t-section-title t-home-quick-title"><strong>روابط سريعة</strong><span>كل ما تحتاجينه</span></div>
      <div className="t-quick-grid">
        <button onClick={onNotifications}><Bell size={17} /><strong>التنبيهات</strong><small>{unread > 0 ? `${unread} غير مقروء` : 'لا جديد'}</small></button>
        <button onClick={onCalendar}><CalendarDays size={17} /><strong>تقويم الأسبوع</strong><small>حلقات الأيام القادمة</small></button>
        <button onClick={onHistory}><History size={17} /><strong>سجلي</strong><small>الحصص والدخول السابق</small></button>
        <button onClick={onRefresh}><CalendarDays size={17} /><strong>تحديث الحلقات</strong><small>{loading ? 'جارٍ التحديث' : 'اسحبي أحدث حالة'}</small></button>
        <button onClick={() => current?.sessionId && onOpenRoster(current.sessionId)} disabled={!current?.sessionId}>
          <Users size={17} /><strong>حضور الطالبات</strong><small>{current?.sessionId ? current.circleName : 'ابدئي حلقة أولًا'}</small>
        </button>
        {canSubscriptions && <button onClick={onSubscriptions}><Wallet size={17} /><strong>الاشتراكات</strong><small>حالة السداد فقط</small></button>}
        {canRequests && <button onClick={onRequests}><CalendarDays size={17} /><strong>طلباتي</strong><small>غياب أو تصحيح حضور</small></button>}
      </div>

      {rest.length > 0 && (
        <>
          <div className="t-section-title t-home-rest-title"><strong>{restTitle}</strong><span>{sessionsLabel(rest.length)}</span></div>
          <div className="t-list t-home-rest-list">
            {rest.map((slot) => (
              <div className="t-row" key={slot.id}>
                <span className={`t-dot ${slot.sessionStatus === 'in_progress' ? 'is-live' : ''}`} />
                <div className="t-row-copy">
                  <strong>{slot.circleName}</strong>
                  <small>{timeRange(slot.startsAt, slot.endsAt)} · {slot.studentCount} طالبة</small>
                </div>
                {slot.sessionId && slot.sessionStatus === 'in_progress'
                  ? <button className="t-text-button" onClick={() => onOpenLive(slot.sessionId!)}>فتح</button>
                  : slot.sessionId && slot.sessionStatus === 'awaiting_attendance'
                    ? <button className="t-text-button" onClick={() => onOpenRoster(slot.sessionId!)}>إكمال</button>
                    : !slot.sessionId && slot.sessionStatus !== 'completed' && slot.canStart
                      ? <button className="t-text-button" onClick={() => onStart(slot)}>بدء</button>
                      : !slot.sessionId && slot.sessionStatus !== 'completed'
                        ? <span className="t-badge t-badge-muted">تبدأ {formatTime12(slot.startsAt)}</span>
                        : <SlotStatus slot={slot} />}
              </div>
            ))}
          </div>
        </>
      )}

      <p className="t-footnote">كل الأوقات بتوقيت القاهرة (Africa/Cairo).</p>
      <button className="t-secondary t-full" onClick={onRefresh} disabled={loading}>{loading ? 'جارٍ التحديث…' : 'تحديث'}</button>
      </div>
    </div>
  )
}
