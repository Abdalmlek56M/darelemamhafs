// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SupervisorWorkspace from './SupervisorWorkspace'
import type { TeacherSession } from './teacherTypes'

const session: TeacherSession = {
  id: 'u1',
  username: 'supervisor',
  displayName: 'المشرفة',
  email: null,
  permissionCodes: ['supervisor.portal'],
  teacherId: null,
}

const noPermissions = {
  canTeacherPortal: false,
  canLive: false,
  canAbsences: false,
  canStudents: false,
  canAddStudents: false,
  canStudentsNotes: false,
  canCircles: false,
  canTeachers: false,
  canTeacherNotes: false,
  canRequests: false,
  canCommunicate: false,
  canUnpaid: false,
  canFinance: false,
  canCorrect: false,
}

function renderWorkspace() {
  render(<SupervisorWorkspace session={session} unread={0} {...noPermissions} onAccount={() => undefined} onLogout={() => undefined} />)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/supervisor')
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('supervisor demo mode storage and banner', () => {
  it('does not restore a sticky demo mode from localStorage and cleans the legacy key', () => {
    localStorage.setItem('dar-supervisor-demo', '1')
    renderWorkspace()
    expect(screen.queryByText(/بيانات تجريبية/)).toBeNull()
    expect(localStorage.getItem('dar-supervisor-demo')).toBeNull()
  })

  it('keeps demo mode in sessionStorage within the tab and shows a persistent banner with an exit', () => {
    sessionStorage.setItem('dar-supervisor-demo', '1')
    renderWorkspace()
    const banner = document.querySelector('.sup-demo-banner') as HTMLElement
    expect(banner).toBeTruthy()
    expect(banner.textContent).toContain('بيانات تجريبية')
    const exit = screen.getByRole('button', { name: 'العودة للبيانات الحقيقية' })
    fireEvent.click(exit)
    expect(document.querySelector('.sup-demo-banner')).toBeNull()
    expect(sessionStorage.getItem('dar-supervisor-demo')).toBe('0')
    expect(localStorage.getItem('dar-supervisor-demo')).toBeNull()
  })
})
