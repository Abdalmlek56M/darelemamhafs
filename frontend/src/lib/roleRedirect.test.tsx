// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { resolvePortalPath } from './roleRedirect'
import HomePage from '../home/HomePage'

describe('resolvePortalPath', () => {
  it('routes admin users to /management', () => {
    expect(resolvePortalPath(['dashboard.read'])).toBe('/management')
    expect(resolvePortalPath(['users.manage', 'supervisor.portal'])).toBe('/management')
  })

  it('routes supervisors to /supervisor', () => {
    expect(resolvePortalPath(['supervisor.portal', 'supervisor.live'])).toBe('/supervisor')
  })

  it('routes teachers to /teacher', () => {
    expect(resolvePortalPath(['teacher.portal', 'teacher.attendance'])).toBe('/teacher')
  })
})

describe('HomePage', () => {
  it('renders about section and unified login button without Google sign-in', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    render(<HomePage />)
    expect(screen.getByText('عن الدار')).toBeTruthy()
    const loginLinks = screen.getAllByRole('link', { name: /تسجيل الدخول/ })
    expect(loginLinks.length).toBeGreaterThan(0)
    expect(loginLinks[0].getAttribute('href')).toBe('/login')
    expect(screen.queryByText(/Google/i)).toBeNull()
  })
})
