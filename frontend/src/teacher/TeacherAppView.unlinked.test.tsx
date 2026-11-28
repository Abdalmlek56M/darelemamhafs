// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TeacherAppView from './TeacherAppView'
import type { useTeacherAppState } from './useTeacherAppState'

describe('TeacherAppView unlinked teacher guard (F2)', () => {
  it('shows a clear error message instead of zeros when teacherId is null', () => {
    const props = {
      checking: false,
      session: {
        id: 'u-1',
        username: 'unlinked_teacher',
        displayName: 'معلمة غير مربوطة',
        permissionCodes: ['teacher.portal', 'teacher.earnings.self'],
        teacherId: null,
      },
      canTeacher: true,
      canSupervisor: false,
      page: 'home',
      logout: vi.fn(),
      outbox: { online: true, pending: 0, legacy: 0, needsReview: 0, lastError: null },
    } as unknown as ReturnType<typeof useTeacherAppState>

    render(<TeacherAppView {...props} />)
    expect(screen.getByRole('alert').textContent).toContain('الحساب غير مرتبط بمعلمة')
    expect(screen.queryByText('مستحق الشهر')).toBeNull()
    expect(screen.queryByText('حلقات اليوم')).toBeNull()
  })
})
