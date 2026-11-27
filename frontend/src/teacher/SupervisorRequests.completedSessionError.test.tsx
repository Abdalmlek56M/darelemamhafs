// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SupervisorRequests from './SupervisorRequests'
import { teacherApi, TeacherApiError } from './teacherApi'
import { defaultMeta } from '../lib/pagination'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SupervisorRequests B13 completed session error display', () => {
  it('shows the server Arabic conflict message when approving absence on a completed session and keeps the request pending', async () => {
    const conflictMessage = 'لا يمكن اعتماد طلب غياب لموعد تم تسجيل حلقته. ارفض الطلب أو عدّل الحضور من الحلقة.'

    vi.spyOn(teacherApi, 'supervisorRequestsPage').mockResolvedValue({
      data: {
        count: 1,
        requests: [
          {
            id: 'req-b13-1',
            type: 'absence',
            status: 'pending',
            reason: 'ظرف طارئ',
            date: '2026-11-27',
            reviewNote: null,
            reviewedAt: null,
            payload: null,
            createdAt: '2026-11-27T10:00:00Z',
            teacherId: 't-1',
            teacherName: 'أ. سارة',
            circleId: 'c-1',
            circleName: 'حلقة الفجر',
            attendanceId: null,
          },
        ],
      },
      meta: defaultMeta(1, 1, 20),
    })

    const reviewSpy = vi
      .spyOn(teacherApi, 'reviewRequest')
      .mockRejectedValueOnce(new TeacherApiError(conflictMessage, 409))

    render(<SupervisorRequests demo={false} />)

    const approveBtn = await screen.findByRole('button', { name: /اعتماد/ })
    fireEvent.click(approveBtn)

    await waitFor(() => {
      expect(screen.getByText(conflictMessage)).toBeTruthy()
    })
    expect(reviewSpy).toHaveBeenCalledWith('req-b13-1', true, 'تمت المراجعة والاعتماد.')
    expect(screen.getByRole('button', { name: /رفض/ })).toBeTruthy()
  })
})
