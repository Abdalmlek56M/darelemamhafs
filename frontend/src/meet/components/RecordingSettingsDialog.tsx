import { useState } from 'react'
import Modal from '../../components/common/Modal'
import { meetApi } from '../meetApi'
import type { MeetSettings } from '../types'

type Props = {
  settings: MeetSettings
  close: () => void
  saved: (next: MeetSettings) => void
}

const numberField = (value: string) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Recording settings: join lead, stop grace, session cap, access type and disk guards. */
export default function RecordingSettingsDialog({ settings, close, saved }: Props) {
  const [form, setForm] = useState({
    joinLeadSeconds: String(settings.joinLeadSeconds),
    stopGraceSeconds: String(settings.stopGraceSeconds),
    diskWarnGb: String(settings.diskWarnGb),
    diskBlockGb: String(settings.diskBlockGb),
    defaultAccessType: settings.defaultAccessType,
    maxSessionMinutes: String(settings.maxSessionMinutes),
    hlsRetentionHours: String(settings.hlsRetentionHours),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await meetApi.updateSettings({
        joinLeadSeconds: numberField(form.joinLeadSeconds),
        stopGraceSeconds: numberField(form.stopGraceSeconds),
        diskWarnGb: numberField(form.diskWarnGb),
        diskBlockGb: numberField(form.diskBlockGb),
        defaultAccessType: form.defaultAccessType as 'open' | 'trusted',
        maxSessionMinutes: numberField(form.maxSessionMinutes),
        hlsRetentionHours: numberField(form.hlsRetentionHours),
      })
      saved(next)
      close()
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'تعذّر حفظ الإعدادات.')
    } finally {
      setSaving(false)
    }
  }

  return <Modal title="إعدادات التسجيل" subtitle="تطبق على كل الحصص القادمة" close={close}>
    <div className="meet-settings-form">
      <label>الانضمام قبل البدء (ثانية)
        <input type="number" min={10} max={600} value={form.joinLeadSeconds}
          onChange={(event) => setForm({ ...form, joinLeadSeconds: event.target.value })} />
      </label>
      <label>مهلة الإيقاف بعد النهاية (ثانية)
        <input type="number" min={0} max={900} value={form.stopGraceSeconds}
          onChange={(event) => setForm({ ...form, stopGraceSeconds: event.target.value })} />
      </label>
      <label>نوع الوصول عند المضيف
        <select value={form.defaultAccessType}
          onChange={(event) => setForm({ ...form, defaultAccessType: event.target.value as 'open' | 'trusted' })}>
          <option value="open">Open — يدخل أي شخص بالرابط</option>
          <option value="trusted">Trusted — المدعوون فقط بدون طلب</option>
        </select>
      </label>
      <label>أقصى مدة للتسجيل (دقيقة)
        <input type="number" min={5} max={720} value={form.maxSessionMinutes}
          onChange={(event) => setForm({ ...form, maxSessionMinutes: event.target.value })} />
      </label>
      <label>تنبيه القرص (GB متبقية)
        <input type="number" min={1} max={500} value={form.diskWarnGb}
          onChange={(event) => setForm({ ...form, diskWarnGb: event.target.value })} />
      </label>
      <label>منع التسجيل عند (GB متبقية)
        <input type="number" min={1} max={500} value={form.diskBlockGb}
          onChange={(event) => setForm({ ...form, diskBlockGb: event.target.value })} />
      </label>
      <label>الاحتفاظ بـHLS (ساعة)
        <input type="number" min={1} max={720} value={form.hlsRetentionHours}
          onChange={(event) => setForm({ ...form, hlsRetentionHours: event.target.value })} />
      </label>
    </div>

    {error && <p className="meet-page-error" role="alert">{error}</p>}

    <div className="meet-settings-actions">
      <button type="button" className="secondary-button" onClick={close} disabled={saving}>إلغاء</button>
      <button type="button" className="primary-button" onClick={() => void save()} disabled={saving}>
        {saving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
      </button>
    </div>
  </Modal>
}
