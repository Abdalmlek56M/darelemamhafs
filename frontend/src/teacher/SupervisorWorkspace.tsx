import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Bell, BookOpen, CalendarDays, ClipboardCheck, GraduationCap, LayoutDashboard, LogOut, Menu, MessageSquareText, Sparkles,
  UserRound, Users, Wallet, X,
} from 'lucide-react'
import SupervisorOverview from './SupervisorOverview'
import SupervisorStudents from './SupervisorStudents'
import SupervisorTeachers from './SupervisorTeachers'
import SupervisorCircles from './SupervisorCircles'
import SupervisorAttendance from './SupervisorAttendance'
import SupervisorAbsences from './SupervisorAbsences'
import SupervisorUnpaid from './SupervisorUnpaid'
import SupervisorTeacherNotes from './SupervisorTeacherNotes'
import SupervisorRequests from './SupervisorRequests'
import SupervisorNotificationsDrawer from './SupervisorNotificationsDrawer'
import type { TeacherSession } from './teacherTypes'
import './supervisor.css'

type Section = 'overview' | 'students' | 'circles' | 'teachers' | 'notes' | 'requests' | 'attendance' | 'absences' | 'unpaid'

type Props = {
  session: TeacherSession
  unread: number
  canTeacherPortal: boolean
  canLive: boolean
  canAbsences: boolean
  canStudents: boolean
  canStudentsNotes: boolean
  canCircles: boolean
  canTeachers: boolean
  canTeacherNotes: boolean
  canRequests: boolean
  canCommunicate: boolean
  canUnpaid: boolean
  canFinance: boolean
  canCorrect: boolean
  onBackToTeacher?: () => void
  onAccount: () => void
  onLogout: () => void
}

const sectionTitles: Record<Section, string> = {
  overview: 'نظرة عامة',
  students: 'الطالبات',
  circles: 'الحلقات',
  teachers: 'المعلمات',
  notes: 'ملاحظات المعلمات',
  requests: 'طلبات المعلمات',
  attendance: 'الحضور',
  absences: 'الغياب',
  unpaid: 'المتأخرات',
}

function initialDemo() {
  try {
    if (new URLSearchParams(window.location.search).get('demo') === '1') return true
    return localStorage.getItem('dar-supervisor-demo') === '1'
  } catch {
    return false
  }
}

export default function SupervisorWorkspace(props: Props) {
  const {
    session, unread, canTeacherPortal, canLive, canAbsences, canStudents, canStudentsNotes,
    canCircles, canTeachers, canTeacherNotes, canRequests, canCommunicate, canUnpaid, canFinance, canCorrect,
    onBackToTeacher, onAccount, onLogout,
  } = props
  const [section, setSection] = useState<Section>('overview')
  const [moreOpen, setMoreOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [localUnread, setLocalUnread] = useState(unread)
  const [focus, setFocus] = useState<{ section: Section; id: string } | null>(null)
  const [demo, setDemo] = useState(initialDemo)

  useEffect(() => { setLocalUnread(unread) }, [unread])

  useEffect(() => {
    try {
      localStorage.setItem('dar-supervisor-demo', demo ? '1' : '0')
      const url = new URL(window.location.href)
      if (demo) url.searchParams.set('demo', '1')
      else url.searchParams.delete('demo')
      window.history.replaceState({}, '', url)
    } catch { /* demo preference is optional */ }
  }, [demo])

  const navItems = useMemo(() => [
    { id: 'overview' as Section, label: 'نظرة عامة', icon: LayoutDashboard, show: true },
    { id: 'students' as Section, label: 'الطالبات', icon: Users, show: canStudents },
    { id: 'circles' as Section, label: 'الحلقات', icon: BookOpen, show: canCircles },
    { id: 'teachers' as Section, label: 'المعلمات', icon: GraduationCap, show: canTeachers },
    { id: 'notes' as Section, label: 'ملاحظات المعلمات', icon: MessageSquareText, show: canTeachers },
    { id: 'requests' as Section, label: 'طلبات المعلمات', icon: ClipboardCheck, show: canRequests },
    { id: 'attendance' as Section, label: 'الحضور', icon: CalendarDays, show: canAbsences },
    { id: 'absences' as Section, label: 'الغياب', icon: AlertTriangle, show: canAbsences },
    { id: 'unpaid' as Section, label: 'المتأخرات', icon: Wallet, show: canUnpaid },
  ].filter((item) => item.show), [canStudents, canCircles, canTeachers, canAbsences, canUnpaid])

  const go = (next: Section) => {
    setSection(next)
    setFocus(null)
    setMoreOpen(false)
  }

  const openTeacher = (id: string) => {
    setFocus({ section: 'teachers', id })
    setSection('teachers')
  }

  const openCircle = (id: string) => {
    setFocus({ section: 'circles', id })
    setSection('circles')
  }

  const toggleDemo = () => setDemo((value) => !value)

  const mobilePrimary = [
    { id: 'overview' as Section, label: 'الرئيسية', icon: LayoutDashboard, show: true },
    { id: 'students' as Section, label: 'الطالبات', icon: Users, show: canStudents },
    { id: 'attendance' as Section, label: 'الحضور', icon: CalendarDays, show: canAbsences },
    { id: 'circles' as Section, label: 'الحلقات', icon: BookOpen, show: !canStudents && canCircles },
  ].filter((item) => item.show)

  const renderSection = () => {
    if (section === 'overview') {
      return <SupervisorOverview demo={demo} canStudents={canStudents} canCircles={canCircles} canTeachers={canTeachers} canAbsences={canAbsences} canUnpaid={canUnpaid} canFinance={canFinance} canCorrect={canCorrect} onNavigate={go} onDemo={toggleDemo} />
    }
    if (section === 'students') return <SupervisorStudents demo={demo} canNote={canStudentsNotes} onOpenCircle={openCircle} canCommunicate={canCommunicate} />
    if (section === 'circles') return <SupervisorCircles demo={demo} onOpenTeacher={openTeacher} focusId={focus?.section === 'circles' ? focus.id : undefined} onFocusConsumed={() => setFocus(null)} />
    if (section === 'teachers') return <SupervisorTeachers demo={demo} canNote={canTeacherNotes} onOpenCircle={openCircle} focusId={focus?.section === 'teachers' ? focus.id : undefined} onFocusConsumed={() => setFocus(null)} canCommunicate={canCommunicate} />
    if (section === 'notes') return <SupervisorTeacherNotes demo={demo} />
    if (section === 'requests') return <SupervisorRequests demo={demo} />
    if (section === 'attendance') return <SupervisorAttendance demo={demo} onOpenTeacher={openTeacher} onOpenCircle={openCircle} />
    if (section === 'absences') return <SupervisorAbsences demo={demo} onOpenTeacher={openTeacher} onOpenCircle={openCircle} canCommunicate={canCommunicate} />
    return <SupervisorUnpaid demo={demo} canFinance={canFinance} canCommunicate={canCommunicate} />
  }

  return (
    <div className="supervisor-app">
      <aside className="sup-sidebar">
        <div className="sup-brand">
          <span className="sup-brand-mark"><Sparkles size={20} /></span>
          <div><strong>دار الإمام حفص</strong><small>مساحة الإشراف</small></div>
        </div>
        <nav className="sup-side-nav" aria-label="أقسام الإشراف">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => go(item.id)}>
                <Icon size={18} /><span>{item.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="sup-side-extra">
          <button className={section === 'overview' && demo ? 'active' : ''} onClick={toggleDemo}>
            <Sparkles size={18} /><span>{demo ? 'إيقاف البيانات التجريبية' : 'عرض نموذج بالبيانات'}</span>
          </button>
          <button onClick={() => setNotificationsOpen(true)}><Bell size={18} /><span>التنبيهات</span>{localUnread > 0 && <em>{localUnread}</em>}</button>
          <button onClick={onAccount}><UserRound size={18} /><span>حسابي</span></button>
          {canTeacherPortal && onBackToTeacher && <button onClick={onBackToTeacher}><GraduationCap size={18} /><span>بوابة المعلمة</span></button>}
        </div>
        <div className="sup-side-foot">
          <div className="sup-user"><span>{session.displayName.slice(0, 1)}</span><div><strong>{session.displayName}</strong><small>@{session.username}</small></div></div>
          <button className="sup-logout" onClick={onLogout} aria-label="تسجيل الخروج"><LogOut size={17} /></button>
        </div>
      </aside>

      <div className="sup-main">
        <header className="sup-topbar">
          <div className="sup-mobile-brand"><span className="sup-brand-mark"><Sparkles size={18} /></span><div><strong>دار الإمام حفص</strong><small>مساحة الإشراف</small></div></div>
          <div className="sup-top-title"><span>مساحة الإشراف</span><h1>{sectionTitles[section]}</h1></div>
          <div className="sup-top-actions">
            {demo && <button className="sup-demo-chip" onClick={toggleDemo}><Sparkles size={13} /> بيانات تجريبية</button>}
            <button className="sup-icon-button" onClick={() => setNotificationsOpen(true)} aria-label="التنبيهات"><Bell size={18} />{localUnread > 0 && <em>{localUnread}</em>}</button>
            <button className="sup-avatar" onClick={onAccount} aria-label="حسابي">{session.displayName.slice(0, 1)}</button>
          </div>
        </header>

        {demo && (
          <div className="sup-demo-banner">
            <Sparkles size={15} />
            <span>أنت تشاهد بيانات تجريبية لعرض الشكل النهائي. لا يتم حفظ أي تعديلات.</span>
            <button onClick={toggleDemo}>العودة للبيانات الحقيقية</button>
          </div>
        )}

        <main className="sup-content">{renderSection()}</main>
      </div>

      <nav className="sup-mobile-nav" aria-label="تنقل الإشراف">
        {mobilePrimary.map((item) => {
          const Icon = item.icon
          return <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => go(item.id)}><Icon size={20} /><span>{item.label}</span></button>
        })}
        <button onClick={() => setNotificationsOpen(true)}><Bell size={20} />{localUnread > 0 && <em>{localUnread}</em>}<span>التنبيهات</span></button>
        <button onClick={() => setMoreOpen(true)}><Menu size={20} /><span>المزيد</span></button>
      </nav>

      {moreOpen && (
        <div className="sup-sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="sup-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="sup-sheet-head"><strong>كل الأقسام</strong><button onClick={() => setMoreOpen(false)} aria-label="إغلاق"><X size={18} /></button></div>
            <div className="sup-sheet-grid">
              {navItems.map((item) => {
                const Icon = item.icon
                return <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => go(item.id)}><Icon size={19} /><span>{item.label}</span></button>
              })}
              <button onClick={() => { setMoreOpen(false); setNotificationsOpen(true) }}><Bell size={19} /><span>التنبيهات</span>{localUnread > 0 && <em>{localUnread}</em>}</button>
              <button onClick={() => { setMoreOpen(false); onAccount() }}><UserRound size={19} /><span>حسابي</span></button>
              {canTeacherPortal && onBackToTeacher && <button onClick={() => { setMoreOpen(false); onBackToTeacher() }}><GraduationCap size={19} /><span>بوابة المعلمة</span></button>}
              <button onClick={() => { toggleDemo(); setMoreOpen(false) }}><Sparkles size={19} /><span>{demo ? 'إيقاف البيانات التجريبية' : 'عرض نموذج بالبيانات'}</span></button>
            </div>
            <button className="sup-sheet-logout" onClick={onLogout}><LogOut size={17} /> تسجيل الخروج</button>
          </div>
        </div>
      )}

      <SupervisorNotificationsDrawer
        open={notificationsOpen}
        canResolve={canCorrect}
        unread={localUnread}
        onClose={() => setNotificationsOpen(false)}
        onUnreadChange={setLocalUnread}
      />
    </div>
  )
}
