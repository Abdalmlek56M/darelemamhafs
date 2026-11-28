import { useEffect, useState, type FormEvent } from 'react'
import AuthPage from './AuthPage'
import ConnectionCheckingView from './ConnectionCheckingView'
import { defaultBranding } from '../domain/defaults'
import type { Branding, LoginCredentials, Notice, Session, SetupCredentials } from '../domain/types'
import { request } from '../services/apiClient'
import { ApiError, loginErrorMessage } from '../lib/userMessages'
import { resolvePortalPath } from '../lib/roleRedirect'

export default function UnifiedLoginPage() {
  const [gate, setGate] = useState<'checking' | 'setup' | 'login'>('checking')
  const [branding, setBranding] = useState<Branding>(defaultBranding)
  const [setup, setSetup] = useState<SetupCredentials>({ username: 'admin', displayName: 'مدير الدار', password: '', confirmPassword: '' })
  const [login, setLogin] = useState<LoginCredentials>({ username: '', password: '', rememberMe: false })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<Notice | null>(null)

  useEffect(() => {
    let mounted = true
    const boot = async () => {
      try {
        try {
          const publicBrand = await request<Branding>('/api/branding')
          if (mounted) setBranding({ ...defaultBranding, ...publicBrand })
        } catch { /* fallback branding */ }
        const status = await request<{ needsInitialAdmin: boolean }>('/api/setup/status')
        if (!mounted) return
        if (status.needsInitialAdmin) {
          setGate('setup')
          return
        }
        try {
          const me = await request<Session>('/api/auth/me')
          if (mounted) window.location.replace(resolvePortalPath(me.permissionCodes))
        } catch {
          if (mounted) setGate('login')
        }
      } catch {
        if (mounted) setGate('login')
      }
    }
    void boot()
    return () => { mounted = false }
  }, [])

  const signInAndRedirect = async (credentials: LoginCredentials) => {
    setSaving(true)
    try {
      const signedIn = await request<Session>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      })
      window.location.replace(resolvePortalPath(signedIn.permissionCodes))
      return true
    } catch (error) {
      const message = error instanceof ApiError && error.status === 401
        ? loginErrorMessage(401, error.message, error.serverMessage)
        : error instanceof Error ? error.message : 'تعذر تسجيل الدخول. راجع البيانات.'
      setToast({ tone: 'error', text: message })
      return false
    } finally {
      setSaving(false)
    }
  }

  const onLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void signInAndRedirect(login)
  }

  const onSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (setup.password.length < 12) {
      setToast({ tone: 'error', text: 'كلمة مرور المدير يجب ألا تقل عن 12 حرفًا.' })
      return
    }
    if (setup.password !== setup.confirmPassword) {
      setToast({ tone: 'error', text: 'تأكيد كلمة المرور غير مطابق.' })
      return
    }
    setSaving(true)
    try {
      const created = await request<Session>('/api/setup/admin', {
        method: 'POST',
        body: JSON.stringify({ username: setup.username, displayName: setup.displayName, password: setup.password }),
      })
      window.location.replace(resolvePortalPath(created.permissionCodes))
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر إعداد الحساب الأول.' })
    } finally {
      setSaving(false)
    }
  }

  if (gate === 'checking') return <ConnectionCheckingView branding={branding} />

  return (
    <AuthPage
      mode={gate}
      branding={branding}
      setup={setup}
      setSetup={setSetup}
      login={login}
      setLogin={setLogin}
      saving={saving}
      onSetup={onSetup}
      onLogin={onLogin}
      onQuickLogin={signInAndRedirect}
      toast={toast}
      clearToast={() => setToast(null)}
    />
  )
}
