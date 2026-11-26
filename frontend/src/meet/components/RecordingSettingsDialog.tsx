import { useState } from 'react'
import { BellRing, Clock, HardDrive, Lock, Settings2 } from 'lucide-react'
import Modal from '../../components/common/Modal'
import { meetApi } from '../meetApi'
import type { MeetSettings } from '../types'

type Props = {
  settings: MeetSettings
  close: () => void
  saved: (next: MeetSettings) => void
}

const toNumber = (value: string) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Recording settings, grouped the same way the owner thinks about them: timing, access,
 * storage and alerts. One field per row so labels and inputs stay aligned at any width.
 */
export default function RecordingSettingsDialog({ settings, close, saved }: Props) {
  const [form, setForm] = useState({
    joinLeadSeconds: String(settings.joinLeadSeconds),
    stopGraceSeconds: String(settings.stopGraceSeconds),
    diskWarnGb: String(settings.diskWarnGb),
    diskBlockGb: String(settings.diskBlockGb),
    defaultAccessType: settings.defaultAccessType,
    maxSessionMinutes: String(settings.maxSessionMinutes),
    hlsRetentionHours: String(settings.hlsRetentionHours),
    telegramBotToken: '',
    telegramChatId: settings.telegramChatId ?? '',
    alertEmail: settings.alertEmail ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await meetApi.updateSettings({
        joinLeadSeconds: toNumber(form.joinLeadSeconds),
        stopGraceSeconds: toNumber(form.stopGraceSeconds),
        diskWarnGb: toNumber(form.diskWarnGb),
        diskBlockGb: toNumber(form.diskBlockGb),
        defaultAccessType: form.defaultAccessType as 'open' | 'trusted',
        maxSessionMinutes: toNumber(form.maxSessionMinutes),
        hlsRetentionHours: toNumber(form.hlsRetentionHours),
        telegramBotToken: form.telegramBotToken.trim() || null,
        telegramChatId: form.telegramChatId.trim() || null,
        alertEmail: form.alertEmail.trim() || null,
      })
      saved(next)
      close()
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'تعذّر حفظ الإعدادات.')
    } finally {
      setSaving(false)
    }
  }

  return <Modal title="إعدادات التسجيل" subtitle="تُطبَّق على الحصص القادمة" close={close}>
    <div className="meet-settings">
      <section className="meet-settings-section">
        <h3><Clock size={14} /> التوقيت</h3>
        <label className="meet-settings-row">
          <span>الانضمام قبل بداية الحصة</span>
          <span className="meet-settings-control">
            <input type="number" min={10} max={600} value={form.joinLeadSeconds} onChange={set('joinLeadSeconds')} />
            <em>ثانية</em>
          </span>
        </label>
        <label className="meet-settings-row">
          <span>الاستمرار بعد انتهاء الوقت</span>
          <span className="meet-settings-control">
            <input type="number" min={0} max={900} value={form.stopGraceSeconds} onChange={set('stopGraceSeconds')} />
            <em>ثانية</em>
          </span>
        </label>
        <label className="meet-settings-row">
          <span>أقصى مدة للتسجيل</span>
          <span className="meet-settings-control">
            <input type="number" min={5} max={720} value={form.maxSessionMinutes} onChange={set('maxSessionMinutes')} />
            <em>دقيقة</em>
          </span>
        </label>
      </section>

      <section className="meet-settings-section">
        <h3><Lock size={14} /> الوصول للاجتماع</h3>
        <label className="meet-settings-row">
          <span>نوع الوصول الافتراضي<small>Open: يدخل أي شخص بالرابط · Trusted: المدعوون فقط</small></span>
          <span className="meet-settings-control">
            <select value={form.defaultAccessType} onChange={set('defaultAccessType')}>
              <option value="open">Open</option>
              <option value="trusted">Trusted</option>
            </select>
          </span>
        </label>
      </section>

      <section className="meet-settings-section">
        <h3><HardDrive size={14} /> التخزين</h3>
        <label className="meet-settings-row">
          <span>تنبيه عند بقاء</span>
          <span className="meet-settings-control">
            <input type="number" min={1} max={500} value={form.diskWarnGb} onChange={set('diskWarnGb')} />
            <em>GB</em>
          </span>
        </label>
        <label className="meet-settings-row">
          <span>منع التسجيل عند بقاء</span>
          <span className="meet-settings-control">
            <input type="number" min={1} max={500} value={form.diskBlockGb} onChange={set('diskBlockGb')} />
            <em>GB</em>
          </span>
        </label>
        <label className="meet-settings-row">
          <span>الاحتفاظ بالبث المباشر HLS</span>
          <span className="meet-settings-control">
            <input type="number" min={1} max={720} value={form.hlsRetentionHours} onChange={set('hlsRetentionHours')} />
            <em>ساعة</em>
          </span>
        </label>
      </section>

      <section className="meet-settings-section">
        <h3><BellRing size={14} /> التنبيهات</h3>
        <label className="meet-settings-row">
          <span>البريد<small>لتلقي تنبيهات فشل التسجيل والأعطال</small></span>
          <span className="meet-settings-control">
            <input type="email" dir="ltr" placeholder="owner@example.com" value={form.alertEmail} onChange={set('alertEmail')} />
          </span>
        </label>
        <label className="meet-settings-row">
          <span>Telegram Bot Token</span>
          <span className="meet-settings-control">
            <input type="password" dir="ltr" placeholder={settings.hasTelegramBotToken ? 'محفوظ — اتركه فارغًا للإبقاء' : '123456:ABC…'} value={form.telegramBotToken} onChange={set('telegramBotToken')} />
          </span>
        </label>
        <label className="meet-settings-row">
          <span>Telegram Chat ID</span>
          <span className="meet-settings-control">
            <input dir="ltr" placeholder="-1001234567890" value={form.telegramChatId} onChange={set('telegramChatId')} />
          </span>
        </label>
      </section>

      {error && <p className="meet-page-error" role="alert">{error}</p>}

      <div className="meet-settings-actions">
        <button type="button" className="secondary-button" onClick={close} disabled={saving}>إلغاء</button>
        <button type="button" className="primary-button" onClick={() => void save()} disabled={saving}>
          <Settings2 size={15} /> {saving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
        </button>
      </div>
    </div>
  </Modal>
}
