import { useState } from 'react'
import { teacherApi, TeacherApiError } from './teacherApi'

type Props = {
  recipientType: 'teacher' | 'student_guardian'
  recipientId: string
  templateKey: 'absence' | 'unpaid' | 'teacher_followup' | 'student_followup'
  canCommunicate: boolean
  demo?: boolean
  label?: string
}

export default function WhatsAppButton({ recipientType, recipientId, templateKey, canCommunicate, demo = false, label = 'واتساب' }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canCommunicate) return null

  const open = async () => {
    if (demo) { setError('الوضع التجريبي — الإرسال معطل.'); return }
    setBusy(true)
    setError(null)
    try {
      const result = await teacherApi.whatsapp(recipientType, recipientId, templateKey)
      window.open(result.href, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تجهيز رسالة واتساب.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="sup-wa-wrap">
      <button type="button" className="sup-wa" onClick={() => void open()} disabled={busy} title={error ?? undefined}>
        {busy ? 'جارٍ التحقق…' : label}
      </button>
      {error && <small className="sup-wa-error">{error}</small>}
    </span>
  )
}
