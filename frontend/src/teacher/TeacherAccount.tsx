import { useState, type FormEvent } from 'react'
import { ArrowRight, KeyRound, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { teacherApi, TeacherApiError } from './teacherApi'
import type { TeacherSession } from './teacherTypes'

type Props = {
  session: TeacherSession
  canSelfPassword: boolean
  onBack?: () => void
  onLogout: () => void
}

export default function TeacherAccount({ session, canSelfPassword, onBack, onLogout }: Props) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (newPassword.length < 6) { setError('كلمة المرور الجديدة 6 أحرف على الأقل.'); return }
    if (newPassword !== confirmPassword) { setError('تأكيد كلمة المرور غير مطابق.'); return }
    setBusy(true)
    try {
      await teacherApi.changePassword(currentPassword, newPassword)
      setChanged(true)
    } catch (err) {
      setError(err instanceof TeacherApiError ? err.message : 'تعذر تغيير كلمة المرور.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="t-page">
      <header className="t-subheader">
        {onBack && <button className="t-icon-button" aria-label="رجوع" onClick={onBack}><ArrowRight size={20} /></button>}
        <div><span className="t-eyebrow">بيانات الحساب</span><h1>حسابي</h1></div>
      </header>

      <div className="t-account-card">
        <span className="t-avatar"><UserRound size={20} /></span>
        <div><strong>{session.displayName}</strong><small>@{session.username}</small></div>
        <span className="t-badge t-badge-ok"><ShieldCheck size={12} /> {session.permissionCodes.length} صلاحية</span>
      </div>

      {!canSelfPassword && !changed && (
        <p className="t-hint">تغيير كلمة المرور متاح من الإدارة فقط. لو محتاجة تغييرها، اطلبي من المدير إعادة تعيينها أو فتح صلاحية تغيير كلمة المرور.</p>
      )}

      {canSelfPassword && !changed && (
        <form className="t-account-card column" onSubmit={submit}>
          <strong><KeyRound size={16} /> تغيير كلمة المرور</strong>
          <label className="t-label" htmlFor="current-password">كلمة المرور الحالية</label>
          <input id="current-password" className="t-input" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
          <label className="t-label" htmlFor="new-password">كلمة المرور الجديدة</label>
          <input id="new-password" className="t-input" type="password" autoComplete="new-password" minLength={6} maxLength={200} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
          <label className="t-label" htmlFor="confirm-password">تأكيد كلمة المرور</label>
          <input id="confirm-password" className="t-input" type="password" autoComplete="new-password" minLength={6} maxLength={200} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
          {error && <p className="t-error">{error}</p>}
          <button className="t-primary" type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'}</button>
        </form>
      )}

      {changed && (
        <div className="t-account-card column">
          <strong>تم تغيير كلمة المرور</strong>
          <p className="t-muted">لأمان الحساب تم إنهاء الجلسة الحالية. سجّلي الدخول بكلمة المرور الجديدة.</p>
          <button className="t-primary" onClick={onLogout}>العودة لتسجيل الدخول</button>
        </div>
      )}

      <button className="t-secondary t-full" onClick={onLogout}><LogOut size={16} /> تسجيل الخروج</button>
      <p className="t-footnote">لا تُحفظ كلمات المرور على هذا الجهاز. يمكن للإدارة قفل الحساب أو إعادة تعيين كلمة المرور.</p>
    </div>
  )
}
