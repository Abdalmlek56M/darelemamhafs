import { useEffect, useState, type FormEvent } from 'react'
import { BookOpen, KeyRound, Trash2, UserRound } from 'lucide-react'
import TurnstileWidget, { type TurnstileStatus } from '../security/TurnstileWidget'

type Props = {
  busy: boolean
  error: string | null
  onLogin: (username: string, password: string, rememberMe: boolean, turnstileToken?: string) => Promise<void>
}

type SavedProfile = {
  username: string
  displayName: string
  lastUsedAt: string
}

const PROFILES_KEY = 'dar-teacher-profiles'
const LAST_USERNAME_KEY = 'dar-teacher-last-username'

function readProfiles(): SavedProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is SavedProfile =>
        Boolean(item) && typeof item.username === 'string' && item.username.length > 0)
      .sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)))
      .slice(0, 5)
  } catch {
    return []
  }
}

export default function TeacherLogin({ busy, error, onLogin }: Props) {
  const [profiles, setProfiles] = useState<SavedProfile[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstile, setTurnstile] = useState<TurnstileStatus>({ enabled: false, ready: false, error: null })
  const [turnstileNotice, setTurnstileNotice] = useState<string | null>(null)
  const [turnstileReset, setTurnstileReset] = useState(0)

  useEffect(() => {
    const saved = readProfiles()
    setProfiles(saved)
    try {
      const last = localStorage.getItem(LAST_USERNAME_KEY)
      if (last) setUsername(last)
      else if (saved[0]) setUsername(saved[0].username)
    } catch { /* ignoring storage errors */ }
  }, [])

  useEffect(() => {
    if (!error) return
    setTurnstileReset(value => value + 1)
    setTurnstileToken(null)
    setTurnstileNotice(null)
  }, [error])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (turnstile.enabled && (!turnstile.ready || !turnstileToken)) {
      setTurnstileNotice('أكمل التحقق الأمني أولًا ثم أعد المحاولة.')
      return
    }
    setTurnstileNotice(null)
    await onLogin(username.trim(), password, rememberMe, turnstileToken ?? undefined)
  }

  const chooseProfile = (profile: SavedProfile) => {
    setUsername(profile.username)
    setPassword('')
    const field = document.getElementById('teacher-login-password')
    field?.focus()
  }

  const forgetProfile = (target: SavedProfile) => {
    const next = profiles.filter((item) => item.username.toLowerCase() !== target.username.toLowerCase())
    setProfiles(next)
    try {
      localStorage.setItem(PROFILES_KEY, JSON.stringify(next))
      if (username.toLowerCase() === target.username.toLowerCase()) {
        localStorage.removeItem(LAST_USERNAME_KEY)
        setUsername('')
        setPassword('')
      }
    } catch { /* ignoring storage errors */ }
  }

  const usingSaved = profiles.some((item) => item.username.toLowerCase() === username.trim().toLowerCase())

  return (
    <div className="t-login">
      <div className="t-login-card">
        <span className="t-brand-mark"><BookOpen size={26} /></span>
        <p className="t-eyebrow">بوابة المعلمة والمشرفة</p>
        <h1>دار الإمام حفص</h1>
        <p className="t-muted">سجّلي الدخول لمتابعة حلقتك، حضور طالباتك، والتنبيهات الموجهة إليك.</p>

        {profiles.length > 0 && (
          <div className="t-saved-profiles">
            <span className="t-saved-title"><UserRound size={13} /> الدخول السريع</span>
            {profiles.map((profile) => (
              <div
                key={profile.username}
                className={`t-saved-profile ${usingSaved && username.trim().toLowerCase() === profile.username.toLowerCase() ? 'active' : ''}`}
              >
                <button type="button" className="t-saved-pick" onClick={() => chooseProfile(profile)} disabled={busy}>
                  <span className="t-avatar">{(profile.displayName || profile.username).slice(0, 1)}</span>
                  <span className="t-saved-text">
                    <strong>{profile.displayName || profile.username}</strong>
                    <small>@{profile.username}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="t-saved-remove"
                  aria-label={`إزالة ${profile.username} من هذا الجهاز`}
                  title="إزالة من هذا الجهاز"
                  onClick={() => forgetProfile(profile)}
                  disabled={busy}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <p className="t-hint">نحفظ اسم المستخدم فقط على هذا الجهاز، ولا نحفظ كلمة المرور.</p>
          </div>
        )}

        <form onSubmit={submit} className="t-form">
          <label>
            اسم المستخدم
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
              minLength={3}
              disabled={busy}
            />
          </label>
          <label>
            كلمة المرور
            <input
              id="teacher-login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              minLength={6}
              disabled={busy}
            />
          </label>
          <label className="t-check">
            <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
            تذكّرني على هذا الجهاز
          </label>
          <TurnstileWidget configUrl="/api/v1/auth/config" resetSignal={turnstileReset} onToken={setTurnstileToken} onStatus={status=>{ setTurnstile(status); if (!status.enabled) setTurnstileNotice(null) }} />
          {(turnstileNotice || turnstile.error) && <p className="t-error" role="alert">{turnstileNotice ?? turnstile.error}</p>}
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
