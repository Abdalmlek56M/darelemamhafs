// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useDarDataLoaders from './useDarDataLoaders'

const requestMock = vi.fn()

vi.mock('../services/apiClient', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

describe('useDarDataLoaders checkHealth (Mission 7)', () => {
  it('sets health to connected when /health returns {"status":"ok"} and down on degraded', async () => {
    const setHealth = vi.fn()
    const noop = vi.fn()
    const { result } = renderHook(() => useDarDataLoaders({
      session: null,
      currentMonthValue: '2026-11',
      busy: false,
      setBusy: noop,
      setToast: noop,
      setHealth,
      setStudents: noop,
      setTeachers: noop,
      setCircles: noop,
      setScheduleSlots: noop,
      setAttendanceRows: noop,
      setStudentAttendanceSummaries: noop,
      setAdvertisingExpenses: noop,
      setOperatingExpenses: noop,
      setCollections: noop,
      setReports: noop,
      setUsers: noop,
      setPermissions: noop,
    }))

    requestMock.mockResolvedValueOnce({ status: 'ok' })
    await act(async () => { await result.current.checkHealth() })
    expect(setHealth).toHaveBeenLastCalledWith('connected')

    requestMock.mockResolvedValueOnce({ status: 'degraded' })
    await act(async () => { await result.current.checkHealth() })
    expect(setHealth).toHaveBeenLastCalledWith('down')
  })
})
