import { CAIRO_TIME_ZONE } from '../../lib/cairoDate'
import { AlertTriangle, CalendarCheck2, CalendarSync, Link2, RefreshCw, ShieldCheck, Unplug } from 'lucide-react'
import type { MeetCalendarStatus, MeetSettings } from '../types'

type Props = {
  status: MeetCalendarStatus | null
  settings: MeetSettings | null
  canManage: boolean
  busy: string | null
  onConnect: () => void
  onSync: (full: boolean) => void
  onDisconnect: () => void
}

function lastSyncLabel(value: string | null) {
  if (!value) return 'لم تتم المزامنة بعد'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    timeZone: CAIRO_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export default function CalendarStatusCard({ status, settings, canManage, busy, onConnect, onSync, onDisconnect }: Props) {
  if (!status) {
    return <section className="panel glass meet-status-card" aria-busy="true"><p className="meet-status-line">جارٍ تحميل حالة تقويم Google…</p></section>
  }

  if (!status.moduleConfigured) {
    return <section className="panel glass meet-status-card meet-status-warning">
      <div className="meet-status-head">
        <span className="stat-icon"><AlertTriangle size={20} /></span>
        <div>
          <h2>وحدة التسجيل غير مهيأة على هذا السيرفر</h2>
          <p>أضف مفاتيح Google والتشفير في <code>/etc/dar/meet.env</code> ثم أعد تشغيل الخدمة. الواجهة لا تتصل بـGoogle قبل ذلك.</p>
        </div>
      </div>
      <ul className="meet-missing-list">
        {status.missingPrerequisites.map((item) => <li key={item}><code>{item}</code></li>)}
      </ul>
    </section>
  }

  if (!status.connected) {
    return <section className="panel glass meet-status-card">
      <div className="meet-status-head">
        <span className="stat-icon"><CalendarCheck2 size={20} /></span>
        <div>
          <h2>اربط تقويم Google الخاص بالدار</h2>
          <p>سجّل الدخول بحساب Gmail المخصص للدار مرة واحدة. يُحفظ تصريح الوصول مشفّرًا، وتُقرأ الأحداث فقط (قراءة فقط، بدون كتابة في التقويم).</p>
        </div>
      </div>
      <div className="meet-status-actions">
        {canManage && <button type="button" className="primary-button" onClick={onConnect} disabled={busy === 'connect'}>
          <Link2 size={16} /> {busy === 'connect' ? 'جارٍ التحويل…' : 'ربط Google'}
        </button>}
        <span className="meet-hint"><ShieldCheck size={14} /> صلاحية القراءة فقط — ولا تُخزَّن كلمة مرور Google في النظام.</span>
      </div>
    </section>
  }

  const needsReconnect = status.status === 'needs_reconnect'
  return <section className={'panel glass meet-status-card' + (needsReconnect ? ' meet-status-warning' : '')}>
    <div className="meet-status-head">
      <span className="stat-icon"><CalendarCheck2 size={20} /></span>
      <div>
        <h2>تقويم Google متصل</h2>
        <p className="meet-status-line">
          <strong dir="ltr">{status.accountEmail}</strong>
          <span className={'status-pill ' + (needsReconnect ? 'status-archived' : 'status-active')}>
            {needsReconnect ? 'يحتاج إعادة ربط' : 'متصل'}
          </span>
        </p>
        <p className="meet-status-line meet-muted">
          آخر مزامنة: {lastSyncLabel(status.lastSyncAt)} · آخر مزامنة كاملة: {lastSyncLabel(status.lastFullSyncAt)}
        </p>
        {status.lastErrorMessage && <p className="meet-status-error">{status.lastErrorMessage}</p>}
      </div>
    </div>

    <div className="meet-status-actions">
      {canManage && <>
        <button type="button" className="primary-button" onClick={() => onSync(false)} disabled={busy === 'sync'}>
          <RefreshCw size={16} /> {busy === 'sync' ? 'جارٍ المزامنة…' : 'مزامنة الآن'}
        </button>
        <button type="button" className="secondary-button" onClick={() => onSync(true)} disabled={busy === 'sync-full'}>
          <CalendarSync size={16} /> {busy === 'sync-full' ? 'جارٍ المزامنة الكاملة…' : 'مزامنة كاملة'}
        </button>
        <button type="button" className="secondary-button" onClick={onConnect} disabled={busy === 'connect'}>
          <Link2 size={16} /> إعادة الربط
        </button>
        <button type="button" className="secondary-button danger-action" onClick={onDisconnect} disabled={busy === 'disconnect'}>
          <Unplug size={16} /> فصل التقويم
        </button>
      </>}
    </div>

    {settings && <div className="meet-limits">
      <span>تسجيل متزامن: <strong>{settings.maxConcurrentSessions}</strong></span>
      <span>دخول البوت قبل الموعد: <strong>{settings.joinLeadSeconds} ثانية</strong></span>
      <span>منع التسجيل أقل من: <strong>{settings.diskBlockGb} جيجابايت</strong></span>
      <span>تنبيه مساحة أقل من: <strong>{settings.diskWarnGb} جيجابايت</strong></span>
      <span>احتفاظ HLS المؤقت: <strong>{settings.hlsRetentionHours} ساعة</strong></span>
    </div>}
  </section>
}