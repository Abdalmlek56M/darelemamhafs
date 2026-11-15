import { BookOpen, CalendarClock, GraduationCap, LayoutDashboard, Settings, ShieldCheck, Users, Wallet } from 'lucide-react'
import type { Page } from './types'

export const navItems: { id: Page; label: string; icon: typeof LayoutDashboard; permission: string }[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard, permission: 'dashboard.read' },
  { id: 'students', label: 'الطلاب', icon: Users, permission: 'students.read' },
  { id: 'teachers', label: 'المعلمات', icon: GraduationCap, permission: 'teachers.read' },
  { id: 'circles', label: 'الحلقات', icon: BookOpen, permission: 'circles.read' },
  { id: 'schedule', label: 'المواعيد وحضور المعلمات', icon: CalendarClock, permission: 'schedule.read' },
  { id: 'payments', label: 'الاشتراكات والتحصيل', icon: Wallet, permission: 'finance.read' },
  { id: 'users', label: 'الحسابات والصلاحيات', icon: ShieldCheck, permission: 'users.manage' },
  { id: 'system', label: 'النظام والنسخ الاحتياطي', icon: Settings, permission: 'settings.manage' },
]
