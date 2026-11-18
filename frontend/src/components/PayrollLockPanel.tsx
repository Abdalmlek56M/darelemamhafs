import { useCallback, useEffect, useState } from 'react'
import { LockKeyhole, LockOpen, ShieldCheck } from 'lucide-react'
import { api } from '../system/api'

export type PayrollLockStatus = {
  month: string
  isLocked: boolean
  lockedAt: string | null
  note: string | null
  unlockedAt: string | null
  unlockNote: string | null
}

type Props = {
  month: string
  canLock: boolean
  canUnlock: boolean
  onChange?: (locked: boolean) => void
}

export default function PayrollLockPanel({ month, canLock, canUnlock, onChange }: Props) {
  const [status, setStatus] = useState<PayrollLockStatus | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (value: string) => {
    setError(null)
    try {
      const data = await api<PayrollLockStatus>(`/api/admin/payroll/lock?month=${encodeURIComponent(value)}`)
      setStatus(data)
      onChange?.(data.isLocked)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل حالة مسير الرواتب.')
    }
  }, [onChange])

  useEffect(() => { void load(month) }, [month, load])

  const change = async (locked: boolean) => {
    if (!note.trim()) { setError(locked ? 'اكتب سبب قفل المسير.' : 'اكتب سبب فتح المسير.'); return }
    setBusy(true)
    setError(null)
    try {
      const data = await api<PayrollLockStatus>(`/api/admin/payroll/${locked ? 'lock' : 'unlock'}`, {
        method: 'POST',
        body: JSON.stringify({ month, note: note.trim() }),
      })
      setStatus(data)
      setNote('')
      onChange?.(data.isLocked)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تغيير حالة المسير.')
    } finally {
      setBusy(false)
    }
  }

  const locked = status?.isLocked ?? false
  return (
    <section className={`payroll-lock-panel glass ${locked ? 'is-locked' : ''}`}>
      <span className="payroll-lock-icon">{locked ? <LockKeyhole size={18} /> : <ShieldCheck size={18} />}</span>
      <div className="payroll-lock-copy">
        <strong>{locked ? `مسير رواتب ${month} مقفل` : `مسير رواتب ${month} مفتوح للتعديل`}</strong>
        <small>{locked ? (status?.note ?? 'لا يمكن تعديل حضور أو أجر هذا الشهر حتى فتح المسير.') : 'يُفضّل قفل المسير بعد اعتماد حضور الشهر لمنع التعديلات غير المقصودة.'}</small>
        {locked && status?.unlockedAt && <small>فُتح سابقًا: {status.unlockNote ?? 'بدون ملاحظة'}</small>}
      </div>
      <div className="payroll-lock-actions">
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder={locked ? 'سبب فتح المسير' : 'سبب قفل المسير'} />
        {locked
          ? canUnlock && <button className="secondary-button compact-button" onClick={() => void change(false)} disabled={busy}><LockOpen size={14} /> {busy ? 'جارٍ الفتح…' : 'فتح المسير'}</button>
          : canLock && <button className="primary-button compact-button" onClick={() => void change(true)} disabled={busy}><LockKeyhole size={14} /> {busy ? 'جارٍ القفل…' : 'قفل المسير'}</button>}
      </div>
      {error && <small className="error-text">{error}</small>}
    </section>
  )
}
