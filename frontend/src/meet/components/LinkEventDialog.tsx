import { useEffect, useState } from 'react'
import Modal from '../../components/common/Modal'
import Field from '../../components/common/Field'
import type { MeetCircleSetting, MeetEvent } from '../types'

type Props = {
  event: MeetEvent
  circles: MeetCircleSetting[]
  saving: boolean
  close: () => void
  save: (circleId: string, enableRecording: boolean) => void
}

/** Mirrors the link dialog: attach one calendar occurrence to exactly one circle. */
export default function LinkEventDialog({ event, circles, saving, close, save }: Props) {
  const [circleId, setCircleId] = useState(event.suggestedCircleId ?? event.circleId ?? '')
  const [enableRecording, setEnableRecording] = useState(false)

  useEffect(() => {
    if (event.suggestedCircleId) setCircleId(event.suggestedCircleId)
  }, [event.suggestedCircleId])

  const selected = circles.find((circle) => circle.circleId === circleId)

  return <Modal
    title="ربط الحدث بحلقة"
    subtitle={event.summary ?? 'حدث بدون عنوان'}
    close={close}
  >
    <form className="form-grid" onSubmit={(formEvent) => {
      formEvent.preventDefault()
      if (!circleId) return
      save(circleId, enableRecording)
    }}>
      <Field label="الحلقة *" wide>
        <select value={circleId} onChange={(changeEvent) => setCircleId(changeEvent.target.value)} required>
          <option value="">— اختر حلقة —</option>
          {circles.map((circle) => <option key={circle.circleId} value={circle.circleId}>
            {circle.name}{circle.isActive ? '' : ' (موقوفة)'}{circle.autoRecord ? ' — تسجيل مفعّل' : ''}
          </option>)}
        </select>
      </Field>

      {event.suggestedCircleName && <p className="meet-dialog-hint wide">
        اقتراح ذكي: <strong>{event.suggestedCircleName}</strong> ({event.suggestedConfidence}% تطابق) — يمكنك اختيار حلقة أخرى.
      </p>}

      {!event.meetLink && <p className="meet-dialog-warn wide">
        هذا الحدث بلا رابط Google Meet، لذلك لن يدخل البوت الاجتماع. يصحّح ذلك من تقويم Google أولًا.
      </p>}

      <label className="meet-checkbox wide">
        <input type="checkbox" checked={enableRecording} onChange={(changeEvent) => setEnableRecording(changeEvent.target.checked)} />
        <span>تفعيل التسجيل التلقائي لهذه الحلقة (لن تُسجَّل بقية حلقاتها تلقائيًا)</span>
      </label>

      {selected && selected.autoRecord && <p className="meet-dialog-hint wide">
        حلقة <strong>{selected.name}</strong> مختارة للتسجيل التلقائي بالفعل.
      </p>}

      <div className="modal-actions wide">
        <button type="button" className="secondary-button" onClick={close} disabled={saving}>إلغاء</button>
        <button type="submit" className="primary-button" disabled={saving || !circleId}>{saving ? 'جارٍ الحفظ…' : 'حفظ الربط'}</button>
      </div>
    </form>
  </Modal>
}
