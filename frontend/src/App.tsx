import { lazy, useEffect, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BookOpen, KeyRound, LockKeyhole, LogOut, Menu, Moon, MoreHorizontal, RefreshCw, Sun, X } from 'lucide-react'
import SocialLinks from './components/common/SocialLinks'
import AuthPage from './pages/AuthPage'
import ConnectionCheckingView from './pages/ConnectionCheckingView'
import useDarApplication from './application/useDarApplication'
import ApplicationDialogs from './components/dialogs/ApplicationDialogs'
import Modal from './components/common/Modal'
import Field from './components/common/Field'
import ModalActions from './components/common/ModalActions'
import PersonalReminderCenter from './components/common/PersonalReminderCenter'
import LazyBoundary from './components/common/LazyBoundary'
import DialogErrorBoundary from './components/common/DialogErrorBoundary'
import { request } from './services/apiClient'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const AdminRequestsPage = lazy(() => import('./pages/AdminRequestsPage'))
const StudentsPage = lazy(() => import('./pages/StudentsPage'))
const TeachersPage = lazy(() => import('./pages/TeachersPage'))
const TeacherNotesPage = lazy(() => import('./pages/TeacherNotesPage'))
const CirclesPage = lazy(() => import('./pages/CirclesPage'))
const SchedulePage = lazy(() => import('./pages/SchedulePage'))
const PaymentsPage = lazy(() => import('./pages/PaymentsPage'))
const MeetPage = lazy(() => import('./meet/MeetPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const SystemPage = lazy(() => import('./pages/SystemPage'))
const ZZErrorBomb = import.meta.env.VITE_ZZ_TEST_ERRORS === '1' ? lazy(() => import('./test/ErrorBomb')) : null

// Short labels for the fixed mobile bottom navigation (the drawer keeps the full labels).
const mobileNavLabels: Record<string, string> = {
  dashboard: 'الرئيسية',
  notifications: 'الإشعارات',
  requests: 'الطلبات',
  students: 'الطلاب',
  teachers: 'المعلمات',
  'teacher-notes': 'ملاحظات',
  circles: 'الحلقات',
  schedule: 'المواعيد',
  payments: 'التحصيل',
  meet: 'التسجيل',
  users: 'الحسابات',
  system: 'النظام',
}

function focusableIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
    .filter((element) => element.getClientRects().length > 0)
}

export default function App() {
  const ctx = useDarApplication()
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const [passwordChanging, setPasswordChanging] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [moreSheetOpen, setMoreSheetOpen] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)
  const moreSheetRef = useRef<HTMLDivElement>(null)
  const overlayOpenerRef = useRef<HTMLElement | null>(null)
  const closePasswordDialog = () => { if (passwordChanging) return; setPasswordDialogOpen(false); setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' }) }
  const submitPasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (passwordForm.newPassword.length < 6) { ctx.setToast({ tone: 'error', text: 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف.' }); return }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { ctx.setToast({ tone: 'error', text: 'تأكيد كلمة المرور الجديدة غير مطابق.' }); return }
    setPasswordChanging(true)
    try {
      await request('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword }) })
      ctx.setToast({ tone: 'success', text: 'تم تغيير كلمة المرور بنجاح.' })
      setPasswordDialogOpen(false)
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (error) {
      ctx.setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تغيير كلمة المرور.' })
    } finally { setPasswordChanging(false) }
  }
  const { theme, setTheme, gate, branding, avatarVersion, avatarAvailable, setAvatarAvailable, session, setup, setSetup, login, setLogin, page, students, saving, busy, toast, setToast, has, visiblePages, refreshAll, doSetup, doLogin, quickLogin, logout, currentTitle, changePage } = ctx

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Mobile navigation overlays: background scroll lock, Escape, focus trap and focus restore.
  useEffect(() => {
    if (!mobileNavOpen && !moreSheetOpen) return
    overlayOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.classList.add('admin-overlay-open')
    const container = mobileNavOpen ? drawerRef.current : moreSheetRef.current
    focusableIn(container)[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMobileNavOpen(false)
        setMoreSheetOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const list = focusableIn(container)
      if (list.length === 0) return
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !container?.contains(active))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.classList.remove('admin-overlay-open')
      const opener = overlayOpenerRef.current
      if (opener?.isConnected) opener.focus()
    }
  }, [mobileNavOpen, moreSheetOpen])

  const navigate = (next: Parameters<typeof changePage>[0]) => {
    changePage(next)
    setMobileNavOpen(false)
    setMoreSheetOpen(false)
  }
  const openMobileNav = () => { setMoreSheetOpen(false); setMobileNavOpen(true) }
  const toggleMoreSheet = () => { setMobileNavOpen(false); setMoreSheetOpen((current) => !current) }
  const primaryPageIds = ['dashboard', 'students', 'circles', 'schedule']
  const primaryPages = (() => {
    const picked = primaryPageIds
      .map((id) => visiblePages.find((item) => item.id === id))
      .filter((item): item is (typeof visiblePages)[number] => Boolean(item))
    for (const item of visiblePages) {
      if (picked.length >= 4) break
      if (!picked.some((entry) => entry.id === item.id)) picked.push(item)
    }
    return picked
  })()
  const morePages = visiblePages.filter((item) => !primaryPages.some((entry) => entry.id === item.id))

  if (gate === 'checking') return <ConnectionCheckingView branding={branding} />
  if (gate === 'setup' || gate === 'login') return <AuthPage mode={gate} branding={branding} setup={setup} setSetup={setSetup} login={login} setLogin={setLogin} saving={saving} onSetup={doSetup} onLogin={doLogin} onQuickLogin={quickLogin} toast={toast} clearToast={() => setToast(null)} />
  if (!session) return <ConnectionCheckingView branding={branding} />

  const navButton = (item: (typeof visiblePages)[number], onSelect: () => void, keyPrefix = '') => {
    const Icon = item.icon
    return <button key={keyPrefix + item.id} type="button" className={'nav-item ' + (page === item.id ? 'active' : '')} aria-current={page === item.id ? 'page' : undefined} onClick={onSelect}><Icon size={18} />{item.label}{item.id === 'students' && students.length > 0 && <span className="nav-count">{students.length}</span>}</button>
  }

  return <div className={'app-shell ' + (busy ? 'is-refreshing-lists' : '')}>
    <aside className="sidebar glass">
      <button className="brand-button" onClick={() => navigate('dashboard')} aria-label="العودة إلى لوحة التحكم"><span className="brand-mark">{branding.logoDataUrl ? <img src={branding.logoDataUrl} alt="شعار الدار" /> : <BookOpen size={24} />}</span><span className="brand-copy"><strong>{branding.brandName}</strong><span>لوحة الإدارة الداخلية</span></span></button>
      <div className="side-section">لوحة الإدارة الداخلية</div>
      <nav className="nav-list" aria-label="القائمة الرئيسية">{visiblePages.map((item) => navButton(item, () => navigate(item.id)))}</nav>
      <div className="sidebar-account"><span className="avatar">{avatarAvailable && <img src={'/api/auth/profile/avatar?v=' + avatarVersion} alt="" onError={() => setAvatarAvailable(false)} onLoad={() => setAvatarAvailable(true)} />}{!avatarAvailable && session.displayName.slice(0, 1)}</span><div><strong>{session.displayName}</strong><small>@{session.username}</small></div><button className="small-icon-button" title="تسجيل الخروج" onClick={() => void logout()}><LogOut size={15} /></button></div>
    </aside>

    <main className="main-content">
      <header className="topbar">
        <button className="icon-button mobile-menu-button" aria-label="فتح قائمة الأقسام" aria-expanded={mobileNavOpen} aria-controls="admin-mobile-drawer" onClick={openMobileNav}><Menu size={20} /></button>
        <div className="welcome"><span className="eyebrow">مساحة إدارية خاصة</span><h1>{currentTitle}</h1><p>{branding.brandName}</p></div>
        <div className="top-actions">
          <button className="icon-button refresh-button" title={busy ? 'جارٍ تحديث القوائم' : 'تحديث كل القوائم'} aria-label="تحديث كل القوائم" aria-busy={busy} disabled={busy} onClick={() => { void refreshAll(); window.dispatchEvent(new Event('dar:refresh-system')) }}><RefreshCw size={17} /></button>
          <PersonalReminderCenter permission={ctx.notificationPermission} onEnableNotifications={ctx.enableNotifications} notify={ctx.notifySystem} />
          <button className="icon-button desktop-shell-action" aria-label="تغيير كلمة المرور" title="تغيير كلمة المرور" onClick={() => setPasswordDialogOpen(true)}><KeyRound size={17} /></button>
          <button className="icon-button theme-toggle desktop-shell-action" aria-label="تغيير المظهر" title={theme === 'dark' ? 'التحويل إلى الوضع الفاتح' : 'التحويل إلى الوضع الداكن'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <button className="icon-button desktop-shell-action" title="تسجيل الخروج" aria-label="تسجيل الخروج" onClick={() => void logout()}><LogOut size={18} /></button>
        </div>
      </header>
      <LazyBoundary key={page} label="جارٍ تحميل الصفحة…" page={currentTitle || 'لوحة الإدارة'} onHome={() => navigate('dashboard')}>
      {ZZErrorBomb && <ZZErrorBomb scope="page" />}
      <AnimatePresence mode="wait">
        {page === 'dashboard' && has('dashboard.read') && <DashboardPage ctx={ctx} />}
        {page === 'notifications' && has('dashboard.read') && <NotificationsPage ctx={ctx} />}
        {page === 'requests' && has('attendance.edit') && <AdminRequestsPage ctx={ctx} />}
        {page === 'students' && <StudentsPage ctx={ctx} />}
        {page === 'teachers' && <TeachersPage ctx={ctx} />}
        {page === 'teacher-notes' && has('teachers.read') && <TeacherNotesPage />}
        {page === 'circles' && <CirclesPage ctx={ctx} />}
        {page === 'schedule' && <SchedulePage ctx={ctx} />}
        {page === 'payments' && <PaymentsPage ctx={ctx} />}
        {page === 'meet' && has('meet.view') && <MeetPage ctx={ctx} />}
        {page === 'users' && <UsersPage ctx={ctx} />}
        {page === 'system' && <SystemPage ctx={ctx} />}
      </AnimatePresence>
      </LazyBoundary>
      {gate === 'ready' && visiblePages.length === 0 && <motion.section className="system-panel glass access-denied-panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><span className="system-heading-icon"><LockKeyhole size={22} /></span><h2>لا توجد صلاحيات مخصصة لهذا الحساب</h2><p>حسابك لا يملك صلاحية عرض أي قسم في لوحة الإدارة. اطلب من مدير الدار منح الصلاحيات المطلوبة، ثم سجّل الخروج وادخل مرة أخرى.</p><button type="button" className="primary-button" onClick={() => void logout()}>تسجيل الخروج</button></motion.section>}
      <footer className="app-footer"><div>© 2026 جميع الحقوق محفوظة <span>•</span> {branding.brandName} <span>•</span> لوحة الإدارة الداخلية</div><SocialLinks branding={branding} /></footer>
    </main>

    {visiblePages.length > 0 && <nav className="admin-mobile-nav" aria-label="التنقل السريع">
      {primaryPages.map((item) => {
        const Icon = item.icon
        const isActive = page === item.id
        return <button key={item.id} type="button" className={isActive ? 'active' : ''} aria-current={isActive ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon size={20} /><span>{mobileNavLabels[item.id] ?? item.label}</span></button>
      })}
      <button type="button" className={moreSheetOpen ? 'active' : ''} aria-current={moreSheetOpen ? 'page' : undefined} aria-expanded={moreSheetOpen} aria-controls="admin-more-sheet" onClick={toggleMoreSheet}><MoreHorizontal size={20} /><span>المزيد</span></button>
    </nav>}

    {mobileNavOpen && <div className="admin-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMobileNavOpen(false) }}>
      <div className="admin-drawer" id="admin-mobile-drawer" role="dialog" aria-modal="true" aria-label="قائمة أقسام لوحة الإدارة" ref={drawerRef}>
        <div className="admin-drawer-head">
          <div className="admin-drawer-brand"><span className="brand-mark">{branding.logoDataUrl ? <img src={branding.logoDataUrl} alt="" /> : <BookOpen size={20} />}</span><div><strong>{branding.brandName}</strong><small>لوحة الإدارة الداخلية</small></div></div>
          <button className="icon-button" aria-label="إغلاق القائمة" onClick={() => setMobileNavOpen(false)}><X size={18} /></button>
        </div>
        <nav className="admin-drawer-nav" aria-label="أقسام لوحة الإدارة">{visiblePages.map((item) => navButton(item, () => navigate(item.id), 'drawer-'))}</nav>
        <div className="admin-drawer-footer">
          <div className="admin-drawer-account"><span className="avatar">{avatarAvailable && <img src={'/api/auth/profile/avatar?v=' + avatarVersion} alt="" onError={() => setAvatarAvailable(false)} onLoad={() => setAvatarAvailable(true)} />}{!avatarAvailable && session.displayName.slice(0, 1)}</span><div><strong>{session.displayName}</strong><small>@{session.username}</small></div></div>
          <div className="admin-drawer-actions">
            <button type="button" className="secondary-button" onClick={() => { setMobileNavOpen(false); setPasswordDialogOpen(true) }}><KeyRound size={16} /> كلمة المرور</button>
            <button type="button" className="secondary-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />} المظهر</button>
            <button type="button" className="secondary-button admin-drawer-logout" onClick={() => void logout()}><LogOut size={16} /> تسجيل الخروج</button>
          </div>
        </div>
      </div>
    </div>}

    {moreSheetOpen && <div className="admin-more-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMoreSheetOpen(false) }}>
      <div className="admin-more-sheet" id="admin-more-sheet" role="dialog" aria-modal="true" aria-label="كل الأقسام" ref={moreSheetRef}>
        <div className="admin-more-head"><strong>كل الأقسام</strong><button className="icon-button" aria-label="إغلاق" onClick={() => setMoreSheetOpen(false)}><X size={18} /></button></div>
        <div className="admin-more-grid">
          {morePages.length === 0 && <p className="admin-more-empty">كل الأقسام المتاحة موجودة في شريط التنقل السفلي.</p>}
          {morePages.map((item) => {
            const Icon = item.icon
            const isActive = page === item.id
            return <button key={item.id} type="button" className={isActive ? 'active' : ''} aria-current={isActive ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon size={20} /><span>{item.label}</span></button>
          })}
        </div>
        <div className="admin-more-account">
          <div className="admin-drawer-account"><span className="avatar">{avatarAvailable && <img src={'/api/auth/profile/avatar?v=' + avatarVersion} alt="" onError={() => setAvatarAvailable(false)} onLoad={() => setAvatarAvailable(true)} />}{!avatarAvailable && session.displayName.slice(0, 1)}</span><div><strong>{session.displayName}</strong><small>@{session.username}</small></div></div>
          <div className="admin-drawer-actions">
            <button type="button" className="secondary-button" onClick={() => { setMoreSheetOpen(false); setPasswordDialogOpen(true) }}><KeyRound size={16} /> كلمة المرور</button>
            <button type="button" className="secondary-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />} المظهر</button>
            <button type="button" className="secondary-button admin-drawer-logout" onClick={() => void logout()}><LogOut size={16} /> تسجيل الخروج</button>
          </div>
        </div>
      </div>
    </div>}

    <DialogErrorBoundary page={currentTitle || 'لوحة الإدارة'} onHome={() => navigate('dashboard')}>
    {ZZErrorBomb && <ZZErrorBomb scope="dialog" />}
    <ApplicationDialogs ctx={ctx} />
    <AnimatePresence>{passwordDialogOpen && <Modal title="تغيير كلمة المرور" subtitle="اكتب كلمة المرور الحالية ثم اختر كلمة مرور جديدة لا تقل عن 6 أحرف." close={closePasswordDialog}><form onSubmit={submitPasswordChange} className="form-grid"><Field label="كلمة المرور الحالية *" wide><input type="password" autoComplete="current-password" required value={passwordForm.currentPassword} onChange={e => setPasswordForm(f => ({ ...f, currentPassword: e.target.value }))} /></Field><Field label="كلمة المرور الجديدة *" wide><input type="password" autoComplete="new-password" required minLength={6} maxLength={200} value={passwordForm.newPassword} onChange={e => setPasswordForm(f => ({ ...f, newPassword: e.target.value }))} /></Field><Field label="تأكيد كلمة المرور الجديدة *" wide><input type="password" autoComplete="new-password" required minLength={6} maxLength={200} value={passwordForm.confirmPassword} onChange={e => setPasswordForm(f => ({ ...f, confirmPassword: e.target.value }))} /></Field><div className="wide"><ModalActions saving={passwordChanging} onCancel={closePasswordDialog} saveLabel="حفظ كلمة المرور" /></div></form></Modal>}</AnimatePresence>
    </DialogErrorBoundary>
  </div>
}
