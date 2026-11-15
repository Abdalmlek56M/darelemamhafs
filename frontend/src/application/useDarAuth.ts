import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Branding, Gate, HistoryData, Notice, Page, Session, Student } from '../domain/types'
import { saveDesktopCredential } from '../services/desktopCredentialBridge'
import { request } from '../services/apiClient'

type SelectedStudentPreview = { id: string; fullName: string; studentCode: string }

type DarAuthOptions = {
  setSession: (value: Session | null) => void
  setFirstPage: (user: Session) => void
  setGate: (value: Gate) => void
  setPage: (value: Page) => void
  setSaving: (value: boolean) => void
  setToast: (notice: Notice) => void
  setBranding: (value: Branding) => void
  setHistory: (value: HistoryData | null) => void
  setSelectedStudent: (value: Student | null) => void
  setSelectedStudentPreview: (value: SelectedStudentPreview | null) => void
}

/**
 * Setup, login, session bootstrap, and logout. The bootstrap decides between
 * setup/login/ready before the dashboard starts loading protected data.
 */
export default function useDarAuth({
  setSession,
  setFirstPage,
  setGate,
  setPage,
  setSaving,
  setToast,
  setBranding,
  setHistory,
  setSelectedStudent,
  setSelectedStudentPreview,
}: DarAuthOptions) {
  const [setup, setSetup] = useState({ username: 'admin', displayName: 'مدير الدار', password: '', confirmPassword: '' })
  const [login, setLogin] = useState({ username: '', password: '', rememberMe: false })

  useEffect(() => {
    let mounted = true
    const start = async () => {
      try {
        try {
          const publicBrand = await request<Branding>('/api/branding')
          if (mounted) {
            setBranding(publicBrand)
            localStorage.setItem('dar-brand-name', publicBrand.brandName)
          }
        } catch { /* keep local fallback if branding cannot be loaded */ }
        const setupStatus = await request<{ needsInitialAdmin: boolean }>('/api/setup/status')
        if (!mounted) return
        if (setupStatus.needsInitialAdmin) { setGate('setup'); return }
        try {
          const me = await request<Session>('/api/auth/me')
          if (!mounted) return
          setSession(me)
          setFirstPage(me)
          setGate('ready')
        } catch { if (mounted) setGate('login') }
      } catch {
        if (mounted) {
          setGate('login')
          setToast({ tone: 'error', text: 'تعذر الاتصال بالخادم. تأكد من تشغيل قاعدة البيانات والـ Backend.' })
        }
      }
    }
    void start()
    return () => { mounted = false }
  }, [setBranding, setFirstPage, setGate, setSession, setToast])

  const doSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (setup.password.length < 12) { setToast({ tone: 'error', text: 'كلمة مرور المدير يجب ألا تقل عن 12 حرفًا.' }); return }
    if (setup.password !== setup.confirmPassword) { setToast({ tone: 'error', text: 'تأكيد كلمة المرور غير مطابق.' }); return }
    setSaving(true)
    try {
      const created = await request<Session>('/api/setup/admin', {
        method: 'POST',
        body: JSON.stringify({ username: setup.username, displayName: setup.displayName, password: setup.password }),
      })
      setSession(created)
      setFirstPage(created)
      setGate('ready')
      setToast({ tone: 'success', text: 'تم إنشاء حساب المدير وتأمين لوحة الإدارة. احتفظ بكلمة المرور في مكان آمن.' })
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر إعداد الحساب الأول.' })
    } finally { setSaving(false) }
  }

  const loginWithCredentials = async (credentials: { username: string; password: string; rememberMe: boolean }) => {
    setSaving(true)
    try {
      const signedIn = await request<Session>('/api/auth/login', { method: 'POST', body: JSON.stringify(credentials) })
      if (credentials.rememberMe) {
        try {
          const raw = localStorage.getItem('dar-saved-profiles')
          const old = raw ? JSON.parse(raw) : []
          const profiles = Array.isArray(old) ? old.filter((item: any) => item && typeof item.username === 'string') : []
          const next = [
            { username: signedIn.username, displayName: signedIn.displayName, lastUsedAt: new Date().toISOString() },
            ...profiles.filter((item: any) => item.username.toLowerCase() !== signedIn.username.toLowerCase()),
          ].slice(0, 6)
          localStorage.setItem('dar-saved-profiles', JSON.stringify(next))
        } catch { /* Saved profile shortcuts are optional; never interrupt a successful login. */ }
        // On the WPF desktop, the password vault encrypts this credential with the current Windows user's DPAPI key.
        saveDesktopCredential(signedIn.username, credentials.password, signedIn.displayName)
      }
      setLogin(current => ({ ...current, password: '', rememberMe: credentials.rememberMe }))
      setSession(signedIn)
      setFirstPage(signedIn)
      setGate('ready')
      setToast({ tone: 'success', text: `أهلًا ${signedIn.displayName}. تم تسجيل الدخول.` })
      return true
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تسجيل الدخول. راجع البيانات.' })
      return false
    } finally { setSaving(false) }
  }

  const doLogin = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); await loginWithCredentials(login) }
  const quickLogin = async (credentials: { username: string; password: string; rememberMe: boolean }) => loginWithCredentials({ ...credentials, rememberMe: true })
  const logout = async () => {
    try { await request('/api/auth/logout', { method: 'POST' }) } catch { /* local state is still cleared */ }
    setSession(null)
    setGate('login')
    setPage('dashboard')
    setHistory(null)
    setSelectedStudent(null)
    setSelectedStudentPreview(null)
  }

  return { setup, setSetup, login, setLogin, doSetup, doLogin, quickLogin, logout }
}
