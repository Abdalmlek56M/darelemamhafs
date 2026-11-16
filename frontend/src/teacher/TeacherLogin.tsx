import { useState, type FormEvent } from 'react'
import { BookOpen, KeyRound } from 'lucide-react'

type Props = {
  busy: boolean
  error: string | null
  onLogin: (username: string, password: string, rememberMe: boolean) => Promise<void>
}

export default function TeacherLogin({ busy, error, onLogin }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await onLogin(username.trim(), password, rememberMe)
  }

  return (
    <div className="t-login">
      <div className="t-login-card">
        <span className="t-brand-mark"><BookOpen size={26} /></span>
        <p className="t-eyebrow">بوابة المعلمة والمشرفة</p>
        <h1>دار الإمام حفص</h1>
        <p className="t-muted">سجّلي الدخول لمتابعة حلقتك، حضور طالباتك، ومستحقاتك.</p>

        <form onSubmit={submit} className="t-form">
          <label>
            اسم المستخدم
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
              minLength={3}
            />
          </label>
          <label>
            كلمة المرور
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              minLength={6}
            />
          </label>
          <label className="t-check">
            <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
            تذكّرني على هذا الجهاز
          </label>
          {error && <p className="t-error">{error}</p>}
          <button className="t-primary" type="submit" disabled={busy}>
            <KeyRound size={18} />
            {busy ? 'جارٍ الدخول…' : 'تسجيل الدخول'}
          </button>
        </form>

        <p className="t-hint">الحساب تُنشئه الإدارة وتربطه بالمعلمة. لا يمكن التسجيل الذاتي.</p>
      </div>
    </div>
  )
}
