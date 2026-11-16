import { useEffect, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BookOpen, KeyRound, LockKeyhole, LogOut, Moon, RefreshCw, Sun } from 'lucide-react'
import SocialLinks from './components/common/SocialLinks'
import AuthPage from './pages/AuthPage'
import ConnectionCheckingView from './pages/ConnectionCheckingView'
import useDarApplication from './application/useDarApplication'
import DashboardPage from './pages/DashboardPage'
import StudentsPage from './pages/StudentsPage'
import TeachersPage from './pages/TeachersPage'
import CirclesPage from './pages/CirclesPage'
import SchedulePage from './pages/SchedulePage'
import PaymentsPage from './pages/PaymentsPage'
import UsersPage from './pages/UsersPage'
import SystemPage from './pages/SystemPage'
import ApplicationDialogs from './components/dialogs/ApplicationDialogs'
import Modal from './components/common/Modal'
import Field from './components/common/Field'
import ModalActions from './components/common/ModalActions'
import PersonalReminderCenter from './components/common/PersonalReminderCenter'
import { request } from './services/apiClient'
import { updateDesktopCredentialIfSaved } from './services/desktopCredentialBridge'





export default function App() {
  const ctx = useDarApplication()
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const [passwordChanging, setPasswordChanging] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const closePasswordDialog = () => { if (passwordChanging) return; setPasswordDialogOpen(false); setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' }) }
  const submitPasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (passwordForm.newPassword.length < 6) { ctx.setToast({ tone: 'error', text: 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف.' }); return }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { ctx.setToast({ tone: 'error', text: 'تأكيد كلمة المرور الجديدة غير مطابق.' }); return }
    setPasswordChanging(true)
    try {
      await request('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword }) })
      if (session) updateDesktopCredentialIfSaved(session.username, passwordForm.newPassword, session.displayName)
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
    try { const webview = (window as Window & { chrome?: { webview?: { postMessage: (message: unknown) => void } } }).chrome?.webview; webview?.postMessage({ type: 'setTheme', theme }) } catch { /* Theme sync is a desktop-only convenience. */ }
  }, [theme])

  if (gate === 'checking') return <ConnectionCheckingView branding={branding} />
  if (gate === 'setup' || gate === 'login') return <AuthPage mode={gate} branding={branding} setup={setup} setSetup={setSetup} login={login} setLogin={setLogin} saving={saving} onSetup={doSetup} onLogin={doLogin} onQuickLogin={quickLogin} toast={toast} clearToast={() => setToast(null)} />
  if (!session) return <ConnectionCheckingView branding={branding} />

  return <div className={`app-shell ${busy ? 'is-refreshing-lists' : ''}`}>
    <aside className="sidebar glass">
      <button className="brand-button" onClick={()=>changePage('dashboard')} aria-label="العودة إلى لوحة التحكم"><span className="brand-mark">{branding.logoDataUrl?<img src={branding.logoDataUrl} alt="شعار الدار"/>:<BookOpen size={24}/>}</span><span className="brand-copy"><strong>{branding.brandName}</strong><span>لوحة الإدارة الداخلية</span></span></button>
      <div className="side-section">لوحة الإدارة الداخلية</div>
      <nav className="nav-list" aria-label="القائمة الرئيسية">{visiblePages.map(item=>{const Icon=item.icon;return <button key={item.id} className={`nav-item ${page===item.id?'active':''}`} onClick={()=>changePage(item.id)}><Icon size={18}/>{item.label}{item.id==='students'&&students.length>0&&<span className="nav-count">{students.length}</span>}</button>})}</nav>
      <div className="sidebar-account"><span className="avatar">{avatarAvailable&&<img src={`/api/auth/profile/avatar?v=${avatarVersion}`} alt="" onError={()=>setAvatarAvailable(false)} onLoad={() => setAvatarAvailable(true)} />}{!avatarAvailable&&session.displayName.slice(0,1)}</span><div><strong>{session.displayName}</strong><small>@{session.username}</small></div><button className="small-icon-button" title="تسجيل الخروج" onClick={()=>void logout()}><LogOut size={15}/></button></div>
      <div className="sidebar-bottom">نسخة سطح المكتب · v0.8.25.0</div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="welcome"><span className="eyebrow">مساحة إدارية خاصة</span><h1>{currentTitle}</h1><p>{branding.brandName}</p></div><div className="top-actions"><button className="icon-button refresh-button" title={busy?'جارٍ تحديث القوائم':'تحديث كل القوائم'} aria-label="تحديث كل القوائم" aria-busy={busy} disabled={busy} onClick={()=>{void refreshAll();window.dispatchEvent(new Event('dar:refresh-system'))}}><RefreshCw size={17}/></button><PersonalReminderCenter permission={ctx.notificationPermission} onEnableNotifications={ctx.enableNotifications} notify={ctx.notifySystem}/><button className="icon-button" aria-label="تغيير كلمة المرور" title="تغيير كلمة المرور" onClick={()=>setPasswordDialogOpen(true)}><KeyRound size={17}/></button><button className="icon-button theme-toggle" aria-label="تغيير المظهر" title={theme==='dark'?'التحويل إلى الوضع الفاتح':'التحويل إلى الوضع الداكن'} onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</button><button className="icon-button" title="تسجيل الخروج" aria-label="تسجيل الخروج" onClick={()=>void logout()}><LogOut size={18}/></button></div></header>
      <AnimatePresence mode="wait">
        {page==='dashboard' && has('dashboard.read') && <DashboardPage ctx={ctx} />}

        {page==='students' && <StudentsPage ctx={ctx} />}

        {page==='teachers' && <TeachersPage ctx={ctx} />}

        {page==='circles' && <CirclesPage ctx={ctx} />}

        {page==='schedule' && <SchedulePage ctx={ctx} />}

        {page==='payments' && <PaymentsPage ctx={ctx} />}

        {page==='users' && <UsersPage ctx={ctx} />}
        {page==='system' && <SystemPage ctx={ctx} />}
      </AnimatePresence>
      {gate === 'ready' && visiblePages.length === 0 && <motion.section className="system-panel glass access-denied-panel" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}><span className="system-heading-icon"><LockKeyhole size={22}/></span><h2>لا توجد صلاحيات مخصصة لهذا الحساب</h2><p>حسابك لا يملك صلاحية عرض أي قسم في لوحة الإدارة. اطلب من مدير الدار منح الصلاحيات المطلوبة، ثم سجّل الخروج وادخل مرة أخرى.</p></motion.section>}
      <footer className="app-footer"><div>© 2026 جميع الحقوق محفوظة <span>•</span> {branding.brandName} <span>•</span> لوحة الإدارة الداخلية · v0.8.25.0</div><SocialLinks branding={branding}/></footer>
    </main>

    <ApplicationDialogs ctx={ctx} />
    <AnimatePresence>{passwordDialogOpen && <Modal title="تغيير كلمة المرور" subtitle="اكتب كلمة المرور الحالية ثم اختر كلمة مرور جديدة لا تقل عن 6 أحرف." close={closePasswordDialog}><form onSubmit={submitPasswordChange} className="form-grid"><Field label="كلمة المرور الحالية *" wide><input type="password" autoComplete="current-password" required value={passwordForm.currentPassword} onChange={e=>setPasswordForm(f=>({...f,currentPassword:e.target.value}))}/></Field><Field label="كلمة المرور الجديدة *" wide><input type="password" autoComplete="new-password" required minLength={6} maxLength={200} value={passwordForm.newPassword} onChange={e=>setPasswordForm(f=>({...f,newPassword:e.target.value}))}/></Field><Field label="تأكيد كلمة المرور الجديدة *" wide><input type="password" autoComplete="new-password" required minLength={6} maxLength={200} value={passwordForm.confirmPassword} onChange={e=>setPasswordForm(f=>({...f,confirmPassword:e.target.value}))}/></Field><div className="wide"><ModalActions saving={passwordChanging} onCancel={closePasswordDialog} saveLabel="حفظ كلمة المرور"/></div></form></Modal>}</AnimatePresence>
  </div>
}
