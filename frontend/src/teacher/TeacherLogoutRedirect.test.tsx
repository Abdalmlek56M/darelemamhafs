// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTeacherAppState } from './useTeacherAppState'
import useDarAuth from '../application/useDarAuth'

const teacherLogoutMock = vi.fn(async () => ({ success: true }))
const teacherMeMock = vi.fn()
const requestMock = vi.fn()

vi.mock('./teacherApi', () => ({
  teacherApi: {
    me: () => teacherMeMock(),
    logout: () => teacherLogoutMock(),
    notifications: vi.fn(async () => ({ items: [], counts: { total: 0, unread: 0 } })),
  },
  TeacherApiError: class TeacherApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

vi.mock('../services/apiClient', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

describe('F4 teacher logout and /management redirect', () => {
  const replaceMock = vi.fn()

  beforeEach(() => {
    teacherLogoutMock.mockReset()
    teacherMeMock.mockReset()
    requestMock.mockReset()
    replaceMock.mockReset()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))
    Object.defineProperty(window, 'location', {
      value: { replace: replaceMock, pathname: '/teacher' },
      writable: true,
    })
  })

  it('ends both sessions and redirects to /login on teacher logout', async () => {
    teacherMeMock.mockResolvedValue({
      id: 'u-1',
      username: 't1',
      displayName: 'معلمة',
      permissionCodes: ['teacher.portal'],
      teacherId: 't-1',
    })

    const { result } = renderHook(() => useTeacherAppState('teacher'))
    await waitFor(() => expect(result.current.checking).toBe(false))

    await act(async () => {
      await result.current.logout()
    })

    expect(teacherLogoutMock).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }))
    expect(replaceMock).toHaveBeenCalledWith('/login')
  })

  it('redirects a teacher opening /management to /teacher', async () => {
    requestMock.mockImplementation(async (url: string) => {
      if (url === '/api/branding') return { brandName: 'دار' }
      if (url === '/api/setup/status') return { needsInitialAdmin: false }
      if (url === '/api/auth/me') throw new Error('401')
      if (url === '/api/v1/auth/me') return { id: 'u-1', permissions: ['teacher.portal', 'teacher.attendance'] }
      return {}
    })

    renderHook(() => useDarAuth({
      setSession: vi.fn(),
      setFirstPage: vi.fn(),
      setGate: vi.fn(),
      setPage: vi.fn(),
      setSaving: vi.fn(),
      setToast: vi.fn(),
      setBranding: vi.fn(),
      setHistory: vi.fn(),
      setSelectedStudent: vi.fn(),
      setSelectedStudentPreview: vi.fn(),
    }))

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/teacher')
    })
  })
})
