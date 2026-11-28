// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MemberPortalComingSoonPage from './MemberPortalComingSoonPage'

const requestMock = vi.fn()

vi.mock('../services/apiClient', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

describe('MemberPortalComingSoonPage (F5)', () => {
  const replaceMock = vi.fn()

  beforeEach(() => {
    requestMock.mockReset()
    replaceMock.mockReset()
    Object.defineProperty(window, 'location', {
      value: { replace: replaceMock, pathname: '/portal' },
      writable: true,
    })
  })

  it('renders coming soon message and logs out to /login for guardian/student accounts', async () => {
    requestMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/auth/me') {
        return { displayName: 'ولي الأمر أحمد', permissions: ['account.password.self'] }
      }
      return { success: true }
    })

    render(<MemberPortalComingSoonPage />)

    await waitFor(() => {
      expect(screen.getByText('بوابتك قريبًا')).toBeTruthy()
    })
    expect(document.title).toContain('بوابة الطالب وولي الأمر')

    fireEvent.click(screen.getByRole('button', { name: /تسجيل الخروج/ }))

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/login')
    })
    expect(requestMock).toHaveBeenCalledWith('/api/v1/auth/logout', { method: 'POST' })
    expect(requestMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' })
  })
})
