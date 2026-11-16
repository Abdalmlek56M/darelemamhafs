import { Bell, CalendarDays, Home, Users } from 'lucide-react'
import type { Page } from './teacherTypes'

type Props = {
  page: Page
  unread: number
  canTeacher: boolean
  canSupervisor: boolean
  activeSessionId: string | null
  onNavigate: (page: Page) => void
  onOpenRoster: (sessionId: string) => void
}

export default function TeacherNav({ page, unread, canTeacher, canSupervisor, activeSessionId, onNavigate, onOpenRoster }: Props) {
  const items = [
    ...(canTeacher ? [
      { id: 'home' as Page, label: 'اليوم', icon: Home, disabled: false },
      { id: 'live' as Page, label: 'الحلقة', icon: CalendarDays, disabled: !activeSessionId },
      { id: 'roster' as Page, label: 'الحضور', icon: Users, disabled: !activeSessionId },
    ] : []),
    { id: 'notifications' as Page, label: 'التنبيهات', icon: Bell, disabled: false },
    ...(canSupervisor ? [{ id: 'supervisor' as Page, label: 'المشرفة', icon: Users, disabled: false }] : []),
  ]

  return (
    <nav className="teacher-nav" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            className={page === item.id ? 'active' : ''}
            disabled={item.disabled}
            onClick={() => item.id === 'roster' && activeSessionId ? onOpenRoster(activeSessionId) : onNavigate(item.id)}
          >
            <Icon size={20} />
            <span>{item.label}</span>
            {item.id === 'notifications' && unread > 0 && <em>{unread}</em>}
          </button>
        )
      })}
    </nav>
  )
}
