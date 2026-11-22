import { useState } from 'react'
import Modal from '../../components/common/Modal'
import Field from '../../components/common/Field'
import type { MeetCircleSetting } from '../types'

export type CreateEventInput = {
  circleId: string
  title: string
  date: string
  startTime: string
  durationMinutes: number
  description: string | null
}

type Props = {
  circles: MeetCircleSetting[]
  today: string
  saving: boolean
  close: () => void
  save: (input: CreateEventInput) => void
}

/** Creates a session in the Dar Google calendar with an attached Meet link. */
export default function CreateEventDialog({ circles, today, saving, close, save }: Props) {
  const [circleId, setCircleId] = useState(circles[0]?.circleId ?? '')
  const circle = circles.find((item) => item.circleId === circleId)
  const [title, setTitle] = useState(circle ? `${circle.name} — حصة` : '')
  const [date, setDate] = useState(today)
  const [startTime, setStartTime] = useState('20:00')
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [description, setDescription] = useState('')

  const pickCircle = (next: string) => {
    setCircleId(next)
    const selected = circles.find((item) => item.circleId === next)
    if (selected && (title.trim().length === 0 || title.endsWith('— حصة'))) {
      setTitle(`${selected.name} — حصة`)
    }
  }

  return <Modal
    title="إنشاء حصة جديدة"
    subtitle="سيُنشأ الموعد في تقويم الدار على Google مع رابط Meet تلقائي، ويُربط بالحلقة المختارة."
    close={close}
  >
    <form className="form-grid" onSubmit={(event) => {
      event.preventDefault()
      if (!circleId || title.trim().length < 3) return
      save({
        circleId,
        title: title.trim(),
        date,
        startTime,
        durationMinutes,
        description: description.trim() ? description.trim() : null
      })
    }}>
      <Field label="الحلقة *" wide>
        <select value={circleId} onChange={(event) => pickCircle(event.target.value)} required>
          <option value="">— اختر حلقة —</option>
          {circles.map((item) => <option key={item.circleId} value={item.circleId}>
            {item.name}{item.isActive ? '' : ' (موقوفة)'}{item.autoRecord ? ' — تسجيل مفعّل' : ''}
          </option>)}
        </select>
      </Field>

      <Field label="عنوان الحصة *" wide>
        <input value={title} maxLength={500} onChange={(event) => setTitle(event.target.value)} required />
      </Field>

      <Field label="التاريخ *">
        <input type="date" value={date} min={today} onChange={(event) => setDate(event.target.value)} required />
      </Field>

      <Field label="وقت البداية *">
        <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required />
      </Field>

      <Field label="المدة">
        <select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>
          <option value={30}>30 دقيقة</option>
          <option value={45}>45 دقيقة</option>
          <option value={60}>60 دقيقة</option>
          <option value={90}>90 دقيقة</option>
          <option value={120}>ساعتان</option>
        </select>
      </Field>

      <Field label="ملاحظات (تظهر في تقويم Google)" wide>
        <textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} />
      </Field>

      {circle && !circle.autoRecord && <p className="meet-dialog-warn wide">
        حلقة «{circle.name}» غير مفعّلة للتسجيل التلقائي. الموعد سيُنشأ ويُربط، لكن لن يُسجَّل إلا بعد تفعيلها من تبويب «نطاق التسجيل» أو اختيار «تسجيل دائمًا» للحدث.
      </p>}

      <div className="modal-actions wide">
        <button type="button" className="secondary-button" onClick={close} disabled={saving}>إلغاء</button>
        <button type="submit" className="primary-button" disabled={saving || !circleId}>
          {saving ? 'جارٍ الإنشاء…' : 'إنشاء الموعد + رابط Meet'}
        </button>
      </div>
    </form>
  </Modal>
}
