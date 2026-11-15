import { BookOpen, RefreshCw } from 'lucide-react'
import type { Branding } from '../domain/types'
export default function ConnectionCheckingView({ branding }: { branding: Branding }) {
  return <div className="auth-screen"><div className="auth-card glass"><span className="brand-mark">{branding.logoDataUrl?<img src={branding.logoDataUrl} alt="شعار الدار"/>:<BookOpen size={26}/>}</span><h1>{branding.brandName}</h1><p>جارٍ التحقق من الجلسة والاتصال…</p><RefreshCw className="spin" size={20}/></div></div>
}
