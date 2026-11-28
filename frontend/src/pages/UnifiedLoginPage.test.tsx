// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UnifiedLoginPage from './UnifiedLoginPage'

const requestMock = vi.fn()

vi.mock('../services/apiClient', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

vi.mock('../security/TurnstileWidget', () => ({
  default: () => null,
}))

describe('UnifiedLoginPage F1 session compatibility', () => {
  const replaceMock = vi.fn()

  beforeEach(() => {
    requestMock.mockReset()
    replaceMock.mockReset()
    Object.defineProperty(window, 'location', {
      value: { replace: replaceMock, pathname: '/login' },
      writable: true,
    })
  })

  it('signs in teachers via /api/v1/auth/password so dar_session and teacherId are issued, then redirects to /teacher', async () => {
    requestMock.mockImplementation(async (url: string) => {
      if (url === '/api/branding') return { brandName: 'دار الإمام حفص' }
      if (url === '/api/setup/status') return { needsInitialAdmin: false }
      if (url === '/api/v1/auth/me') throw new Error('401')
      if (url === '/api/v1/auth/password') {
        return {
          id: 'u-1',
          username: 't_fatima',
          displayName: 'فاطمة',
          permissions: ['teacher.portal', 'teacher.attendance'],
          teacherId: 't-1',
        }
      }
      return {}
    })

    render(<UnifiedLoginPage />)

    await waitFor(() => {
      expect(screen.getByLabelText('اسم المستخدم')).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('اسم المستخدم'), { target: { value: 't_fatima' } })
    fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'Secret123!' } })
    fireEvent.click(screen.getByRole('button', { name: /تسجيل الدخول/ }))

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/teacher')
    })

    expect(requestMock).toHaveBeenCalledWith('/api/v1/auth/password', expect.objectContaining({ method: 'POST' }))
    expect(requestMock).not.toHaveBeenCalledWith('/api/auth/login', expect.anything())
  })
})
