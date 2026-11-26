import { afterEach, describe, expect, it, vi } from 'vitest'
import { teacherApi } from './teacherApi'

const realFetch = globalThis.fetch

afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks() })

function mockFetch(body: unknown, responseHeaders: Record<string, string>) {
  const spied = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: responseHeaders }))
  globalThis.fetch = spied as unknown as typeof fetch
  return spied
}

describe('teacher portal pagination', () => {
  it('requests a supervisor students page with search params and portal header', async () => {
    const spied = mockFetch({ count: 2, students: [{ id: 's1' }, { id: 's2' }] }, {
      'X-Total-Count': '37', 'X-Page': '2', 'X-Page-Size': '25', 'X-Truncated': 'true',
    })
    const page = await teacherApi.supervisorStudentsPage({ search: 'سارة', page: 2, pageSize: 25 })
    const [url, init] = spied.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/supervisor/students?')
    expect(url).toContain('page=2')
    expect(url).toContain('pageSize=25')
    expect(url).toContain(`search=${encodeURIComponent('سارة')}`)
    expect(new Headers(init.headers).get('X-Dar-Portal')).toBe('teacher')
    expect(page.data.students).toHaveLength(2)
    expect(page.meta).toEqual({ page: 2, pageSize: 25, total: 37, truncated: true })
  })

  it('requests circle and teacher pages with page params', async () => {
    mockFetch({ count: 1, circles: [{ id: 'c1' }] }, { 'X-Total-Count': '1', 'X-Page': '1', 'X-Page-Size': '25' })
    const circles = await teacherApi.supervisorCirclesPage({ page: 1, pageSize: 25 })
    expect(circles.meta.total).toBe(1)
    expect(circles.data.circles).toHaveLength(1)

    mockFetch({ count: 1, teachers: [{ id: 't1' }] }, { 'X-Total-Count': '1', 'X-Page': '1', 'X-Page-Size': '25' })
    const teachers = await teacherApi.supervisorTeachersPage({ search: 'هدى', page: 1, pageSize: 25 })
    expect(teachers.data.teachers).toHaveLength(1)
  })

  it('requests an absences page for one day', async () => {
    const spied = mockFetch({ date: '2026-11-30', absences: [], students: [], teachers: [], counts: { students: 0, teachers: 0 } }, {
      'X-Total-Count': '9', 'X-Page': '1', 'X-Page-Size': '25',
    })
    const page = await teacherApi.supervisorAbsencesPage({ date: '2026-11-30', page: 1, pageSize: 25 })
    const [url] = spied.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('date=2026-11-30')
    expect(url).toContain('page=1')
    expect(url).toContain('pageSize=25')
    expect(page.meta.total).toBe(9)
  })

  it('requests attendance, unpaid and request pages', async () => {
    mockFetch({ date: '2026-11-30', count: 1, sessions: [{ scheduleSlotId: 's1' }] }, {
      'X-Total-Count': '3', 'X-Page': '2', 'X-Page-Size': '25',
    })
    const teachers = await teacherApi.supervisorTeacherAttendancePage({ date: '2026-11-30', page: 2, pageSize: 25 })
    expect(teachers.data.sessions).toHaveLength(1)
    expect(teachers.meta).toEqual({ page: 2, pageSize: 25, total: 3, truncated: false })

    mockFetch({ date: '2026-11-30', count: 1, attendance: [{ attendanceId: 'a1' }] }, { 'X-Total-Count': '4' })
    const students = await teacherApi.supervisorStudentAttendancePage({ date: '2026-11-30', page: 1, pageSize: 25 })
    expect(students.data.attendance).toHaveLength(1)
    expect(students.meta.total).toBe(4)

    mockFetch({ month: '2026-11', today: '2026-11-30', canViewAmounts: true, count: 1, unpaid: [{ chargeId: 'c1' }] }, {
      'X-Total-Count': '5', 'X-Page': '1', 'X-Page-Size': '25',
    })
    const unpaid = await teacherApi.supervisorUnpaidPage({ month: '2026-11', page: 1, pageSize: 25 })
    expect(unpaid.data.unpaid).toHaveLength(1)
    expect(unpaid.meta.total).toBe(5)

    mockFetch({ count: 1, requests: [{ id: 'r1' }] }, { 'X-Total-Count': '6' })
    const requests = await teacherApi.supervisorRequestsPage({ status: 'pending', page: 1, pageSize: 25 })
    expect(requests.data.requests).toHaveLength(1)
    expect(requests.meta.total).toBe(6)
  })

  it('requests teacher notifications, history, requests and notes pages', async () => {
    mockFetch({ counts: { open: 2, unread: 1 }, notifications: [{ id: 'n1' }] }, {
      'X-Total-Count': '7', 'X-Page': '2', 'X-Page-Size': '25', 'X-Truncated': 'false',
    })
    const notifications = await teacherApi.notificationsPage({ status: 'all', page: 2, pageSize: 25 })
    expect(notifications.data.notifications).toHaveLength(1)
    expect(notifications.meta).toEqual({ page: 2, pageSize: 25, total: 7, truncated: false })

    mockFetch({ sessions: [{ id: 's1' }], attendance: [{ id: 'a1' }], logins: [], sessionTotal: 9, attendanceTotal: 8 }, {
      'X-Total-Count': '9', 'X-Page': '1', 'X-Page-Size': '25',
    })
    const history = await teacherApi.teacherHistoryPage({ page: 1, pageSize: 25 })
    expect(history.data.sessionTotal).toBe(9)
    expect(history.data.attendanceTotal).toBe(8)
    expect(history.meta.total).toBe(9)

    mockFetch({ count: 1, requests: [{ id: 'r1' }] }, { 'X-Total-Count': '11' })
    const teacherRequests = await teacherApi.teacherRequestsPage({ page: 1, pageSize: 25 })
    expect(teacherRequests.data.requests).toHaveLength(1)
    expect(teacherRequests.meta.total).toBe(11)

    mockFetch({ count: 1, notes: [{ id: 'x1' }], banner: 'ملاحظة' }, { 'X-Total-Count': '13' })
    const notes = await teacherApi.supervisorTeacherNotesPage({ kind: 'session', page: 1, pageSize: 25 })
    expect(notes.data.notes).toHaveLength(1)
    expect(notes.meta.total).toBe(13)
  })
})
