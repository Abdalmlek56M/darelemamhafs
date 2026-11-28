import { useEffect, useState } from 'react'
import { BookOpen, LockKeyhole, Sparkles } from 'lucide-react'
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
          <span><strong>{branding.brandName}</strong><small>دار تحفيظ القرآن الكريم</small></span>
        </a>
        <nav>
          <a className="home-admin-link" href="/login"><LockKeyhole size={15} /> تسجيل الدخول</a>
        </nav>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <span className="home-eyebrow"><Sparkles size={14} /> عن الدار</span>
          <h1>{branding.brandName}<br /><em>لتعليم القرآن الكريم والتجويد.</em></h1>
          <p>بيئة تعليمية منظمة تجمع حلقات التحفيظ الفردية والجماعية، ومتابعة الحضور والالتزام اليومي للطلاب والمعلمات والمشرفات.</p>
          <div className="home-actions">
            <a className="home-primary" href="/login"><LockKeyhole size={18} /> تسجيل الدخول</a>
          </div>
        </section>

        <section className="home-strip">
          <div><strong>حلقات فردية وجماعية</strong><small>برامج مخصصة للأطفال والكبار وفق جدول أسبوعي واضح.</small></div>
          <div><strong>متابعة يومية</strong><small>تسجيل حضور الحلقات والطالبات وتوثيق التقدم باستمرار.</small></div>
          <div><strong>دخول موحد</strong><small>صفحة دخول واحدة توجّه كل مستخدم إلى بوابته تلقائيًا.</small></div>
        </section>
      </main>

      <footer className="home-footer">
        <span>© 2026 {branding.brandName}</span>
        <span>جميع الحقوق محفوظة</span>
      </footer>
    </div>
  )
}
