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

function renderWorkspace(onLogout: () => void = () => undefined) {
  render(<SupervisorWorkspace session={session} unread={0} {...noPermissions} onAccount={() => undefined} onLogout={onLogout} />)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/supervisor')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('supervisor demo mode production gating', () => {
  it('disables demo mode in a production build even with ?demo=1 and a stored tab flag', () => {
    vi.stubEnv('PROD', true)
    sessionStorage.setItem('dar-supervisor-demo', '1')
    window.history.replaceState({}, '', '/supervisor?demo=1')
    renderWorkspace()
    expect(document.querySelector('.sup-demo-banner')).toBeNull()
    expect(screen.queryByRole('button', { name: /بيانات تجريبية|عرض نموذج بالبيانات/ })).toBeNull()
  })

  it('allows demo mode in a production build only with the explicit test flag', () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_ENABLE_DEMO', '1')
    window.history.replaceState({}, '', '/supervisor?demo=1')
    renderWorkspace()
    expect(document.querySelector('.sup-demo-banner')).toBeTruthy()
  })
})

describe('supervisor demo mode lifecycle', () => {
  it('clears demo mode from sessionStorage, legacy localStorage and the URL on logout', () => {
    const onLogout = vi.fn()
    localStorage.setItem('dar-supervisor-demo', '1')
    sessionStorage.setItem('dar-supervisor-demo', '1')
    window.history.replaceState({}, '', '/supervisor?demo=1')
    renderWorkspace(onLogout)
    expect(document.querySelector('.sup-demo-banner')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الخروج' }))

    expect(onLogout).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('dar-supervisor-demo')).toBeNull()
    expect(localStorage.getItem('dar-supervisor-demo')).toBeNull()
    expect(new URLSearchParams(window.location.search).get('demo')).toBeNull()
  })
})
