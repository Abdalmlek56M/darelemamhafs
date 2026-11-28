// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CirclesPage from './CirclesPage'
import type { DarApplicationContext } from '../application/useDarApplication'
import type { Circle } from '../domain/types'

const requestPageMock = vi.fn()

vi.mock('../services/apiClient', () => ({
  requestPage: (...args: unknown[]) => requestPageMock(...args),
}))

const circleA: Circle = {
  id: 'c-1',
  circleCode: 'CIR-1',
  name: 'حلقة الفجر',
  teacherId: null,
  teacherName: '',
  monthlyFee: 100,
  scheduleText: null,
  isActive: true,
  activeStudentCount: 0,
  startsOn: '2026-01-01',
  circleType: 'group',
  isChildren: false,
}

const circleB: Circle = {
  ...circleA,
  id: 'c-2',
  circleCode: 'CIR-2',
  name: 'حلقة العصر الجديدة',
}

describe('CirclesPage live refresh after circle creation (F3)', () => {
  it('reloads the circles list when ctx.circles updates without a page reload', async () => {
    requestPageMock
      .mockResolvedValueOnce({ data: [circleA], meta: { page: 1, pageSize: 50, total: 1, truncated: false } })
      .mockResolvedValueOnce({ data: [circleA, circleB], meta: { page: 1, pageSize: 50, total: 2, truncated: false } })

    const makeCtx = (circles: Circle[]) => ({
      circles,
      has: () => true,
      openCircleCreate: vi.fn(),
      openCircleDetails: vi.fn(),
      openCircleEdit: vi.fn(),
      deleteCircle: vi.fn(),
    }) as unknown as DarApplicationContext

    const { rerender } = render(<CirclesPage ctx={makeCtx([circleA])} />)

    await waitFor(() => {
      expect(screen.getByText('حلقة الفجر')).toBeTruthy()
    })
    expect(screen.queryByText('حلقة العصر الجديدة')).toBeNull()

    rerender(<CirclesPage ctx={makeCtx([circleA, circleB])} />)

    await waitFor(() => {
      expect(screen.getByText('حلقة العصر الجديدة')).toBeTruthy()
    })
  })
})
