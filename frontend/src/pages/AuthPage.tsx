import { useEffect, useState, type Dispatch, type FormEventHandler, type SetStateAction } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, LockKeyhole, RefreshCw, ShieldCheck, UserRound, X } from 'lucide-react'
import type { Branding, LoginCredentials, Notice, SetupCredentials } from '../domain/types'
import SocialLinks from '../components/common/SocialLinks'
import ToastView from '../components/common/ToastView'
import TurnstileWidget, { type TurnstileStatus } from '../security/TurnstileWidget'

type SavedProfile = { username: string; displayName: string; lastUsedAt?: string }

type Props = {
  mode: 'setup' | 'login'
  branding: Branding
  setup: SetupCredentials
  setSetup: Dispatch<SetStateAction<SetupCredentials>>
  login: LoginCredentials
  setLogin: Dispatch<SetStateAction<LoginCredentials>>
  saving: boolean
  onSetup: FormEventHandler<HTMLFormElement>
  onLogin: FormEventHandler<HTMLFormElement>
  onQuickLogin: (credentials: LoginCredentials) => Promise<boolean>
  toast: Notice | null
  clearToast: () => void
}

export default function AuthPage({ mode, branding, setup, setSetup, login, setLogin, saving, onSetup, onLogin, onQuickLogin, toast, clearToast }: Props) {
  const [savedProfiles, setSavedProfiles] = useState<SavedProfile[]>(() => {
    try { const value = JSON.parse(localStorage.getItem('dar-saved-profiles') || '[]'); return Array.isArray(value) ? value.filter((item): item is SavedProfile => !!item && typeof item.username === 'string' && typeof item.displayName === 'string').slice(0,6) : [] }
    catch { return [] }
  })
  const [turnstile, setTurnstile] = useState<TurnstileStatus>({ enabled: false, ready: false, error: null })
  const [turnstileNotice, setTurnstileNotice] = useState<string | null>(null)
  const [turnstileReset, setTurnstileReset] = useState(0)

  useEffect(() => {
    if (toast?.tone === 'error') setTurnstileReset(value => value + 1)
  }, [toast])
  const useProfile = (profile: SavedProfile) => {
    if (turnstile.enabled && (!turnstile.ready || !login.turnstileToken)) { setTurnstileNotice('أكمل التحقق الأمني أولًا ثم أعد المحاولة.'); return }
    setLogin(current => ({ ...current, username: profile.username, password: '', rememberMe: true }))
  }
  const handleLoginSubmit: FormEventHandler<HTMLFormElement> = event => {
    if (turnstile.enabled && (!turnstile.ready || !login.turnstileToken)) {
      event.preventDefault()
      setTurnstileNotice('أكمل التحقق الأمني أولًا ثم أعد المحاولة.')
      return
    }
    setTurnstileNotice(null)
    onLogin(event)
  }

  const removeProfile = (username: string) => { const next = savedProfiles.filter(profile => profile.username.toLowerCase() !== username.toLowerCase()); setSavedProfiles(next); try { localStorage.setItem('dar-saved-profiles', JSON.stringify(next)) } catch { /* ignore local profile storage errors */ } }
  return <div className="auth-screen"><motion.div className="auth-card glass" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}}>
    <span className="brand-mark">{branding.logoDataUrl?<img src={branding.logoDataUrl} alt="شعار الدار"/>:<BookOpen size={27}/>}</span><span className="eyebrow">لوحة الإدارة الداخلية</span><h1>{branding.brandName}</h1><p className="auth-description">هذه لوحة إدارة خاصة وليست الموقع العام للدار. يلزم تسجيل الدخول للوصول إلى السجلات والبيانات.</p>
    {mode==='login' && savedProfiles.length>0 && <div className="saved-profiles-panel"><div className="saved-profiles-heading"><strong>حسابات محفوظة على هذا الجهاز</strong><small>اضغط لاختيار الحساب ثم أدخل كلمة المرور.</small></div><div className="saved-profiles-grid">{savedProfiles.map(profile=><div className="saved-profile" key={profile.username}><button type="button" className="saved-profile-select" onClick={()=>void useProfile(profile)}><span className="saved-profile-avatar"><UserRound size={16}/></span><span><strong>{profile.displayName}</strong><small>@{profile.username}</small></span></button><button type="button" className="saved-profile-remove" aria-label={`إزالة ${profile.displayName} من الحسابات المحفوظة`} title="إزالة الحساب المحفوظ" onClick={()=>removeProfile(profile.username)}><X size={13}/></button></div>)}</div></div>}
    {mode==='setup' ? <form onSubmit={onSetup} className="auth-form"><h2>إعداد حساب المدير الأول</h2><p>الحساب الأول يحصل على جميع الصلاحيات، ويمكنك لاحقًا إنشاء حسابات بصلاحيات محددة.</p>
      <label className="form-field"><span>اسم المستخدم</span><input required minLength={3} maxLength={100} autoComplete="username" value={setup.username} onChange={e=>setSetup(s=>({...s,username:e.target.value}))}/></label>
      <label className="form-field"><span>اسم المدير الظاهر</span><input required maxLength={160} autoComplete="name" value={setup.displayName} onChange={e=>setSetup(s=>({...s,displayName:e.target.value}))}/></label>
      <label className="form-field"><span>كلمة المرور (6 أحرف على الأقل)</span><input type="password" required minLength={6} maxLength={200} autoComplete="new-password" value={setup.password} onChange={e=>setSetup(s=>({...s,password:e.target.value}))}/></label>
      <label className="form-field"><span>تأكيد كلمة المرور</span><input type="password" required minLength={6} maxLength={200} autoComplete="new-password" value={setup.confirmPassword} onChange={e=>setSetup(s=>({...s,confirmPassword:e.target.value}))}/></label>
      <button className="primary-button full-width" type="submit" disabled={saving}>{saving?<RefreshCw className="spin" size={16}/>:<ShieldCheck size={16}/>} إنشاء حساب المدير</button>
    </form> : <form onSubmit={handleLoginSubmit} className="auth-form"><h2>تسجيل الدخول</h2>
      <label className="form-field"><span>اسم المستخدم</span><input required autoComplete="username" value={login.username} onChange={e=>setLogin(s=>({...s,username:e.target.value}))}/></label>
      <label className="form-field"><span>كلمة المرور</span><input type="password" required autoComplete="current-password" value={login.password} onChange={e=>setLogin(s=>({...s,password:e.target.value}))}/></label>
      <label className="remember-me-option"><input type="checkbox" checked={login.rememberMe} onChange={e=>setLogin(s=>({...s,rememberMe:e.target.checked}))}/><span><strong>تذكّرني على هذا الجهاز</strong><small>يحافظ على تسجيل الدخول لمدة تصل إلى 30 يومًا. لا تفعّله على جهاز مشترك.</small></span></label>
      <TurnstileWidget configUrl="/api/auth/config" resetSignal={turnstileReset} onToken={token=>setLogin(s=>({...s,turnstileToken: token ?? undefined}))} onStatus={status=>{ setTurnstile(status); if (!status.enabled) setTurnstileNotice(null) }} />
      {(turnstileNotice || turnstile.error) && <p className="turnstile-notice" role="alert">{turnstileNotice ?? turnstile.error}</p>}
      <button className="primary-button full-width" type="submit" disabled={saving}>{saving?<RefreshCw className="spin" size={16}/>:<LockKeyhole size={16}/>} تسجيل الدخول</button>
      <p className="auth-password-help">نسيت كلمة المرور؟ اطلب من مدير لديه صلاحية إدارة الحسابات تعيين كلمة مرور جديدة من قسم «إدارة الحسابات». لأمان البيانات، لا تُحفظ كلمات المرور على الجهاز.</p>
    </form>}
    <div className="auth-security"><LockKeyhole size={15}/><span>جلسة محمية · صلاحيات على مستوى الأقسام والعمليات</span></div>
  </motion.div><SocialLinks branding={branding} className="auth-social-links"/><div className="copyright-line">© 2026 جميع الحقوق محفوظة · {branding.brandName}</div><ToastView toast={toast} clear={clearToast}/></div>
}
