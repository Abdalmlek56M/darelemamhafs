import { useEffect, useState } from 'react'
import { ArrowLeft, BookOpen, GraduationCap, ShieldCheck, Sparkles, Users } from 'lucide-react'
import './home.css'

type Branding = {
  brandName: string
  logoDataUrl: string | null
  facebookUrl: string | null
  tiktokUrl: string | null
  whatsappUrl: string | null
}

const fallback: Branding = { brandName: 'دار الإمام حفص للقرآن والتجويد', logoDataUrl: null, facebookUrl: null, tiktokUrl: null, whatsappUrl: null }

export default function HomePage() {
  const [branding, setBranding] = useState<Branding>(fallback)

  useEffect(() => {
    fetch('/api/branding', { credentials: 'include' })
      .then((response) => response.ok ? response.json() : fallback)
      .then((data) => setBranding({ ...fallback, ...data }))
      .catch(() => setBranding(fallback))
  }, [])

  return (
    <div className="home-page">
      <header className="home-nav">
        <a className="home-brand" href="/">
          <span className="home-logo">{branding.logoDataUrl ? <img src={branding.logoDataUrl} alt="" /> : <BookOpen size={24} />}</span>
          <span><strong>{branding.brandName}</strong><small>بوابة الدار</small></span>
        </a>
        <nav>
          <a href="/teacher">بوابة المعلمة</a>
          <a href="/supervisor">مساحة الإشراف</a>
          <a className="home-admin-link" href="/management"><ShieldCheck size={15} /> دخول الإدارة</a>
        </nav>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <span className="home-eyebrow"><Sparkles size={14} /> دار الإمام حفص</span>
          <h1>مساحة واحدة تجمع<br /><em>الإدارة والتعليم والمتابعة.</em></h1>
          <p>بوابة موحدة للطالبات والمعلمات والمشرفات والإدارة، مع حضور واشتراكات وتقارير ومتابعة يومية.</p>
          <div className="home-actions">
            <a className="home-primary" href="/management"><ShieldCheck size={18} /> دخول الإدارة</a>
            <a className="home-secondary" href="/teacher"><GraduationCap size={18} /> بوابة المعلمة</a>
            <a className="home-secondary" href="/supervisor"><Users size={18} /> مساحة الإشراف</a>
          </div>
        </section>

        <section className="home-portals">
          <a className="home-portal admin" href="/management">
            <span><ShieldCheck size={22} /></span>
            <h2>لوحة الإدارة</h2>
            <p>الطلاب والمعلمات والحلقات والاشتراكات والتقارير وحسابات النظام.</p>
            <b>الدخول إلى لوحة الإدارة <ArrowLeft size={15} /></b>
          </a>
          <a className="home-portal teacher" href="/teacher">
            <span><GraduationCap size={22} /></span>
            <h2>بوابة المعلمة</h2>
            <p>حلقات اليوم، تسجيل الحضور، المستحقات، التنبيهات والطلبات.</p>
            <b>الدخول إلى البوابة <ArrowLeft size={15} /></b>
          </a>
          <a className="home-portal supervisor" href="/supervisor">
            <span><Users size={22} /></span>
            <h2>مساحة الإشراف</h2>
            <p>متابعة الحلقات والمعلمات والطالبات والحضور والغياب والاشتراكات.</p>
            <b>الدخول إلى المساحة <ArrowLeft size={15} /></b>
          </a>
        </section>

        <section className="home-strip">
          <div><strong>متابعة يومية</strong><small>حضور المعلمات والطالبات في شاشة واحدة.</small></div>
          <div><strong>خصوصية مالية</strong><small>المبالغ تظهر فقط بصلاحية المالية.</small></div>
          <div><strong>وصول حسب النطاق</strong><small>كل مشرفة ترى الحلقات المسندة إليها.</small></div>
        </section>
      </main>

      <footer className="home-footer">
        <span>© 2026 {branding.brandName}</span>
        <span>لوحة الإدارة الداخلية · بوابة المعلمة · مساحة الإشراف</span>
      </footer>
    </div>
  )
}
