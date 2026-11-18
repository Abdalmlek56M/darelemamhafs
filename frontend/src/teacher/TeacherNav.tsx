import { Bell, BookOpen, CalendarDays, ClipboardList, Home, UserRound, Users } from 'lucide-react'
import type { Page } from './teacherTypes'

type Props = {
  page: Page
  unread: number
  canTeacher: boolean
  canRequests: boolean
  activeSessionId: string | null
  onNavigate: (page: Page) => void
  onOpenRoster: (sessionId: string) => void
}

export default function TeacherNav({ page, unread, canTeacher, canRequests, activeSessionId, onNavigate, onOpenRoster }: Props) {
  const items = [
    ...(canTeacher ? [
      { id: 'home' as Page, label: 'اليوم', icon: Home, disabled: false },
      { id: 'live' as Page, label: 'الحلقة', icon: CalendarDays, disabled: !activeSessionId },
      { id: 'roster' as Page, label: 'الحضور', icon: Users, disabled: !activeSessionId },
    ] : []),
    { id: 'notifications' as Page, label: 'التنبيهات', icon: Bell, disabled: false },
    ...(canRequests ? [{ id: 'requests' as Page, label: 'الطلبات', icon: ClipboardList, disabled: false }] : []),
    { id: 'account' as Page, label: 'حسابي', icon: UserRound, disabled: false },
  ]

  return (
    <nav className="teacher-nav">
      <div className="teacher-nav-brand">
        <span className="t-brand-mark"><BookOpen size={22} /></span>
        <span><strong>بوابة المعلمة</strong><small>دار الإمام حفص</small></span>
      </div>
      <div className="teacher-nav-items" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            className={page === item.id ? 'active' : ''}
            aria-current={page === item.id ? 'page' : undefined}
            disabled={item.disabled}
            onClick={() => item.id === 'roster' && activeSessionId ? onOpenRoster(activeSessionId) : onNavigate(item.id)}
          >
            <Icon size={20} />
            <span>{item.label}</span>
            {item.id === 'notifications' && unread > 0 && <em>{unread}</em>}
          </button>
        )
      })}
      </div>
    </nav>
  )
}
