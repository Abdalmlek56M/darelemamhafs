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
})
