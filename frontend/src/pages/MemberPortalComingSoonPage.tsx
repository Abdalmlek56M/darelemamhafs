import { useEffect, useState } from 'react'
import { BookOpen, LogOut } from 'lucide-react'
import { request } from '../services/apiClient'
import { resolvePortalPath } from '../lib/roleRedirect'

type V1Session = {
  displayName?: string
  permissions?: string[]
  permissionCodes?: string[]
}

export default function MemberPortalComingSoonPage() {
  const [displayName, setDisplayName] = useState('')
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let mounted = true
    request<V1Session>('/api/v1/auth/me')
      .then((me) => {
        if (!mounted) return
        const target = resolvePortalPath(me.permissions ?? me.permissionCodes ?? [])
        if (target !== '/portal') {
          window.location.replace(target)
          return
        }
        setDisplayName(me.displayName ?? '')
        setChecking(false)
      })
      .catch(() => {
        if (mounted) window.location.replace('/login')
      })
    return () => { mounted = false }
  }, [])

  const logout = async () => {
    await Promise.allSettled([
      request('/api/v1/auth/logout', { method: 'POST' }),
      request('/api/auth/logout', { method: 'POST' }),
    ])
    window.location.replace('/login')
  }

  if (checking) {
    return <div className="auth-screen"><div className="auth-card glass"><p>جارٍ التحقق من الجلسة…</p></div></div>
  }

  return (
    <div className="auth-screen">
      <div className="auth-card glass">
        <span className="brand-mark"><BookOpen size={27} /></span>
        <span className="eyebrow">بوابة ولي الأمر والطالب</span>
        <h1>بوابتك قريبًا</h1>
        <p className="auth-description">
          {displayName ? `أهلًا ${displayName}. ` : ''}
          بوابة ولي الأمر والطالب قيد التجهيز حاليًا وستتوفر قريبًا.
        </p>
        <button type="button" className="primary-button full-width" onClick={() => void logout()}>
          <LogOut size={16} /> تسجيل الخروج
        </button>
      </div>
    </div>
  )
}
