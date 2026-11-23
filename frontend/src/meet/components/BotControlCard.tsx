import { useCallback, useEffect, useState } from 'react'
import { Bell, Bot, Pause, Play, Square, UserRound } from 'lucide-react'
import { meetApi } from '../meetApi'
import { cairoTime } from '../format'
import type { MeetActiveJob, MeetAlert } from '../types'

type Props = { canControl: boolean }

const statusLabels: Record<string, string> = {
  scheduled: 'في الانتظار',
  joining: 'ينضم الآن',
  live: 'يسجّل',
  finalizing: 'يجهّز الملف',
  uploading: 'يرفع',
}

/**
 * Live control strip: start the bot on any Meet link, watch participants, pause, resume or
 * stop the current recording, and read the operational alerts.
 */
export default function BotControlCard({ canControl }: Props) {
  const [active, setActive] = useState<MeetActiveJob | null>(null)
  const [alerts, setAlerts] = useState<MeetAlert[]>([])
  const [link, setLink] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [job, feed] = await Promise.all([meetApi.botActive(), meetApi.alerts(8)])
      setActive(job.active ? job : null)
      setAlerts(feed.alerts.filter((item) => !item.isRead))
    } catch {
      /* keep the previous state on a transient failure */
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 8000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const act = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await work()
      setMessage(success)
      await refresh()
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'تعذّر تنفيذ الأمر.')
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    if (!/^https:\/\/meet\.google\.com\/[a-z0-9-]+/i.test(link.trim())) {
      setError('أدخل رابط Google Meet صحيح مثل https://meet.google.com/abc-defg-hij')
      return
    }
    await act(async () => {
      await meetApi.botJoin(link.trim(), title.trim() || undefined)
      setLink('')
      setTitle('')
    }, 'أُرسل البوت للانضمام. سيظهر هنا خلال ثوانٍ.')
  }

  return <section className="panel glass meet-control-card">
    <div className="meet-control-head">
      <div className="toolbar-copy">
        <h2 style={{ fontSize: 14, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Bot size={16} /> بوت التسجيل
        </h2>
        <p style={{ margin: 0 }}>
          {active
            ? `${statusLabels[active.status ?? ''] ?? active.status} · ${active.summary ?? 'بدون عنوان'}`
            : 'يدخل تلقائيًا قبل الحصص المجدولة بدقيقة — أو أرسله الآن لأي رابط Meet.'}
        </p>
      </div>
      {active && <span className="status-pill status-active">
        <UserRound size={13} /> {active.participants ?? 0} داخل الاجتماع
      </span>}
    </div>

    {active && <div className="meet-control-active">
      {active.meetLink && <a className="text-link" href={active.meetLink} target="_blank" rel="noreferrer">
        {active.meetLink.replace('https://', '')}
      </a>}
      <span className="meet-muted">
        {active.startedAt ? `بدأ ${cairoTime(active.startedAt)}` : 'لم يبدأ بعد'}
        {active.paused ? ' · موقوف مؤقتًا' : ''}
      </span>
      <div className="meet-control-actions">
        {canControl && <button type="button" className="secondary-button" disabled={busy}
          onClick={() => void act(() => meetApi.botPause(active.id!, !active.paused), active.paused ? 'استُكمل التسجيل.' : 'أُوقف مؤقتًا.')}>
          {active.paused ? <><Play size={15} /> استكمال</> : <><Pause size={15} /> إيقاف مؤقت</>}
        </button>}
        {canControl && <button type="button" className="danger-button" disabled={busy}
          onClick={() => void act(() => meetApi.botStop(active.id!), 'أُرسل أمر الإيقاف؛ سيُجهّز الملف خلال ثوانٍ.')}>
          <Square size={15} /> إيقاف التسجيل
        </button>}
      </div>
    </div>}

    <div className="meet-control-start">
      <input className="text-input" dir="ltr" placeholder="https://meet.google.com/abc-defg-hij"
        value={link} onChange={(event) => setLink(event.target.value)} disabled={!canControl || busy} />
      <input className="text-input" placeholder="عنوان التسجيل (اختياري)"
        value={title} onChange={(event) => setTitle(event.target.value)} disabled={!canControl || busy} />
      <button type="button" className="primary-button" onClick={() => void start()} disabled={!canControl || busy}>
        <Bot size={15} /> شغّل البوت
      </button>
    </div>

    {message && <p className="meet-muted" role="status">{message}</p>}
    {error && <p className="meet-page-error" role="alert">{error}</p>}

    {alerts.length > 0 && <div className="meet-alerts">
      <div className="meet-alerts-head">
        <span><Bell size={14} /> تنبيهات ({alerts.length})</span>
        <button type="button" className="small-link" onClick={() => void act(() => meetApi.markAlertsRead(), 'تم التعليم كمقروء.')}>
          تعليم الكل كمقروء
        </button>
      </div>
      {alerts.map((alert) => <div key={alert.id} className={`meet-alert severity-${alert.severity}`}>
        <strong>{alert.title}</strong>
        {alert.body && <span>{alert.body}</span>}
        <small className="meet-muted">{cairoTime(alert.createdAt)}</small>
      </div>)}
    </div>}
  </section>
}
