// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TeachersPage from './TeachersPage'
import type { DarApplicationContext } from '../application/useDarApplication'

vi.mock('../services/apiClient', () => ({
  requestPage: vi.fn(async () => ({
    data: [{
      id: 't-1',
      teacherCode: 'TCH-001',
      fullName: 'أ. فاطمة',
      phone: '01012345678',
      hourlyRate: 100,
      status: 'active',
      notes: null,
      circleNames: 'حلقة الفجر',
      circleCount: 1,
    }],
    meta: { page: 1, pageSize: 50, total: 1, truncated: false },
  })),
}))

describe('TeachersPage phone column alignment', () => {
  it('centers the phone column header and cell in the teachers table', async () => {
    const ctx = {
      has: () => true,
      openTeacherDetails: vi.fn(),
      openTeacherCreate: vi.fn(),
      openTeacherEdit: vi.fn(),
      deleteTeacher: vi.fn(),
    } as unknown as DarApplicationContext

    render(<TeachersPage ctx={ctx} />)
    await waitFor(() => {
      expect(screen.getAllByText('01012345678').length).toBeGreaterThan(0)
    })

    const header = screen.getByRole('columnheader', { name: 'الهاتف' })
    const cell = screen.getByRole('cell', { name: '01012345678' })
    expect(header.className).toContain('cell-center')
    expect(cell.className).toContain('cell-center')
  })
})
