import type {
  AttendanceMark, AttendanceRequest, CreateAttendanceRequest, EarningsResponse, EndResponse, NotificationsResponse, RosterResponse,
  StartResponse, SubscriptionsResponse, SupervisorAbsencesResponse, SupervisorAttendanceRequest, SupervisorCircleDetailResponse,
  SupervisorCirclesResponse, SupervisorLiveResponse, SupervisorStudentDetailResponse, SupervisorStudentsResponse,
  SupervisorTeacherAttendanceRow, SupervisorTeacherDetailResponse, SupervisorTeacherNotesResponse, SupervisorTeachersResponse,
  SupervisorUnpaidResponse, SupervisorStudentAttendanceRow, TeacherSession, TodayResponse,
} from './teacherTypes'
import type { TeacherCalendarResponse, TeacherHistoryResponse } from './teacherCalendarTypes'
import { isArabicUserMessage, normalizeUserMessage } from '../lib/userMessages'
import { PORTAL_PAGE_SIZE, parsePageMeta, type PagedResponse } from '../lib/pagination'

export class TeacherApiError extends Error {
  status: number
  serverMessage?: string
  constructor(message: string, status: number, serverMessage?: string) {
    super(message)
    this.status = status
    this.serverMessage = serverMessage
  }
}

type ParsedError = { message: string; serverMessage: string | null }

async function readError(response: Response): Promise<ParsedError> {
  let body: any = null
  try { body = await response.json() } catch { /* non-JSON error */ }
  const messages: string[] = []
  if (typeof body?.message === 'string') messages.push(body.message)
  if (typeof body?.detail === 'string') messages.push(body.detail)
  if (body?.errors && typeof body.errors === 'object') {
    for (const value of Object.values(body.errors) as unknown[]) {
      if (Array.isArray(value)) messages.push(...value.filter((item): item is string => typeof item === 'string'))
      else if (typeof value === 'string') messages.push(value)
    }
  }
  const arabic = messages.filter(isArabicUserMessage)
  if (arabic.length > 0) {
    const message = arabic.join(' ')
    return { message, serverMessage: message }
  }
  return { message: normalizeUserMessage(messages.join(' '), response.status), serverMessage: null }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  // P1-2: the teacher portal must never fall back to the admin bridge cookie.
  headers.set('X-Dar-Portal', 'teacher')
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(path, { ...init, headers, credentials: 'include', cache: 'no-store' })
  } catch (error) {
    const message = normalizeUserMessage(error instanceof Error ? error.message : null, 0)
    throw new TeacherApiError(message, 0)
  }
  if (!response.ok) {
    const parsed = await readError(response)
    throw new TeacherApiError(parsed.message, response.status, parsed.serverMessage ?? undefined)
  }
  return response
}

async function decode<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T
  return await response.json() as T
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return await decode<T>(await send(path, init))
}

async function requestPage<T>(path: string, init?: RequestInit, fallbackPageSize = PORTAL_PAGE_SIZE): Promise<PagedResponse<T>> {
  const response = await send(path, init)
  const data = await decode<T>(response)
  const record = data as unknown as Record<string, unknown> | null
  const returned = Array.isArray(data)
    ? data.length
    : record && typeof record.count === 'number'
      ? record.count
      : 0
  return { data, meta: parsePageMeta(response.headers, returned, fallbackPageSize) }
}

export const teacherApi = {
  me: () => request<TeacherSession>('/api/v1/auth/me'),
  login: (username: string, password: string, rememberMe: boolean, turnstileToken?: string) =>
    request<TeacherSession>('/api/v1/auth/password', {
      method: 'POST',
      body: JSON.stringify({ username, password, rememberMe, turnstileToken }),
    }),
  logout: () => request<{ success: boolean }>('/api/v1/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ success: boolean }>('/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  today: () => request<TodayResponse>('/api/v1/teacher/today'),
  start: (scheduleSlotId: string) =>
    request<StartResponse>('/api/v1/teacher/sessions/start', {
      method: 'POST',
      body: JSON.stringify({ scheduleSlotId }),
    }),
  end: (sessionId: string, note: string) =>
    request<EndResponse>(`/api/v1/teacher/sessions/${sessionId}/end`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  roster: (sessionId: string) => request<RosterResponse>(`/api/v1/teacher/sessions/${sessionId}/roster`),
  submit: (sessionId: string, students: AttendanceMark[]) =>
    request<{ sessionId: string; status: string; present: number; excused: number; absent: number; total: number }>(
      `/api/v1/teacher/sessions/${sessionId}/attendance`,
      { method: 'POST', body: JSON.stringify({ students }) },
    ),
  earnings: (month?: string) =>
    request<EarningsResponse>(`/api/v1/teacher/earnings${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  subscriptions: (month?: string) =>
    request<SubscriptionsResponse>(`/api/v1/teacher/subscriptions${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  notifications: (status: 'open' | 'resolved' | 'all' = 'all') =>
    request<NotificationsResponse>(`/api/v1/notifications?status=${status}`),
  read: (id: string) => request<{ id: string; read: boolean }>(`/api/v1/notifications/${id}/read`, { method: 'POST' }),
  readAll: () => request<{ read: number }>('/api/v1/notifications/read-all', { method: 'POST' }),
  resolve: (id: string, note: string) =>
    request<{ id: string; status: string }>(`/api/v1/notifications/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  supervisorLive: () => request<SupervisorLiveResponse>('/api/v1/supervisor/live'),
  supervisorAbsences: (date?: string) =>
    request<SupervisorAbsencesResponse>(`/api/v1/supervisor/absences${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  supervisorUnpaid: (month?: string) =>
    request<SupervisorUnpaidResponse>(`/api/v1/supervisor/unpaid${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  adjustAttendance: (attendanceId: string, payableDurationMinutes: number, payableAmount: number | null, note: string) =>
    request<{ attendanceId: string; payableMinutes: number; payableAmount: number; note: string }>(
      `/api/v1/supervisor/attendance/${attendanceId}/adjust`,
      { method: 'POST', body: JSON.stringify({ payableDurationMinutes, payableAmount, note }) },
    ),
  supervisorStudents: (search?: string, circleId?: string) => {
    const params = new URLSearchParams()
    if (search?.trim()) params.set('search', search.trim())
    if (circleId) params.set('circleId', circleId)
    const query = params.size ? `?${params.toString()}` : ''
    return request<SupervisorStudentsResponse>(`/api/v1/supervisor/students${query}`)
  },
  supervisorStudent: (id: string) =>
    request<SupervisorStudentDetailResponse>(`/api/v1/supervisor/students/${id}`),
  addStudentNote: (id: string, text: string) =>
    request<{ id: string; text: string }>(`/api/v1/supervisor/students/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  supervisorCircles: (search?: string) => {
    const query = search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''
    return request<SupervisorCirclesResponse>(`/api/v1/supervisor/circles${query}`)
  },
  supervisorCircle: (id: string) =>
    request<SupervisorCircleDetailResponse>(`/api/v1/supervisor/circles/${id}`),
  addCircleStudents: (id: string, studentIds: string[]) =>
    request<{ added: number; skipped: number }>(`/api/v1/supervisor/circles/${id}/students`, {
      method: 'POST',
      body: JSON.stringify({ studentIds }),
    }),
  supervisorTeachers: (search?: string) => {
    const query = search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''
    return request<SupervisorTeachersResponse>(`/api/v1/supervisor/teachers${query}`)
  },
  supervisorTeacher: (id: string) =>
    request<SupervisorTeacherDetailResponse>(`/api/v1/supervisor/teachers/${id}`),
  addTeacherNote: (id: string, text: string) =>
    request<{ id: string; text: string }>(`/api/v1/supervisor/teachers/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  supervisorTeacherNotes: (kind?: string, teacherId?: string) => {
    const params = new URLSearchParams()
    if (kind && kind !== 'all') params.set('kind', kind)
    if (teacherId) params.set('teacherId', teacherId)
    const query = params.size ? `?${params.toString()}` : ''
    return request<SupervisorTeacherNotesResponse>(`/api/v1/supervisor/teacher-notes${query}`)
  },
  supervisorStudentsPage: (params: { search?: string; circleId?: string; page: number; pageSize: number }) => {
    const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) })
    if (params.search?.trim()) query.set('search', params.search.trim())
    if (params.circleId) query.set('circleId', params.circleId)
    return requestPage<SupervisorStudentsResponse>(`/api/v1/supervisor/students?${query.toString()}`)
  },
  supervisorCirclesPage: (params: { search?: string; page: number; pageSize: number }) => {
    const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) })
    if (params.search?.trim()) query.set('search', params.search.trim())
    return requestPage<SupervisorCirclesResponse>(`/api/v1/supervisor/circles?${query.toString()}`)
  },
  supervisorTeachersPage: (params: { search?: string; page: number; pageSize: number }) => {
    const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) })
    if (params.search?.trim()) query.set('search', params.search.trim())
    return requestPage<SupervisorTeachersResponse>(`/api/v1/supervisor/teachers?${query.toString()}`)
  },
  supervisorAbsencesPage: (params: { date: string; page: number; pageSize: number }) =>
    requestPage<SupervisorAbsencesResponse>(
      `/api/v1/supervisor/absences?date=${encodeURIComponent(params.date)}&page=${params.page}&pageSize=${params.pageSize}`),
  supervisorTeacherAttendancePage: (params: { date?: string; circleId?: string; page: number; pageSize: number }) => {
    const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) })
    if (params.date) query.set('date', params.date)
    if (params.circleId) query.set('circleId', params.circleId)
    return requestPage<{ date: string; count: number; sessions: SupervisorTeacherAttendanceRow[] }>(
      `/api/v1/supervisor/attendance/teachers?${query.toString()}`)
  },
  supervisorStudentAttendancePage: (params: { date?: string; circleId?: string; page: number; pageSize: number }) => {
    const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) })
    if (params.date) query.set('date', params.date)
    if (params.circleId) query.set('circleId', params.circleId)
    return requestPage<{ date: string; count: number; attendance: SupervisorStudentAttendanceRow[] }>(
      `/api/v1/supervisor/attendance/students?${query.toString()}`)
  },
  supervisorUnpaidPage: (params: { month?: string; page: number; pageSize: number }) => {
    const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) })
    if (params.month) query.set('month', params.month)
    return requestPage<SupervisorUnpaidResponse>(`/api/v1/supervisor/unpaid?${query.toString()}`)
  },
  supervisorRequestsPage: (params: { status: string; page: number; pageSize: number }) =>
    requestPage<{ count: number; requests: SupervisorAttendanceRequest[] }>(
      `/api/v1/supervisor/requests?status=${encodeURIComponent(params.status)}&page=${params.page}&pageSize=${params.pageSize}`),
  teacherCalendar: (from?: string, days = 7) => {
    const params = new URLSearchParams({ days: String(days) })
    if (from) params.set('from', from)
    return request<TeacherCalendarResponse>(`/api/v1/teacher/calendar?${params.toString()}`)
  },
  teacherHistory: (limit = 50) =>
    request<TeacherHistoryResponse>(`/api/v1/teacher/history?limit=${limit}`),
  supervisorTeacherAttendance: (date?: string, circleId?: string) => {
    const params = new URLSearchParams()
    if (date) params.set('date', date)
    if (circleId) params.set('circleId', circleId)
    const query = params.size ? `?${params.toString()}` : ''
    return request<{ date: string; count: number; sessions: SupervisorTeacherAttendanceRow[] }>(
      `/api/v1/supervisor/attendance/teachers${query}`)
  },
  supervisorStudentAttendance: (date?: string, circleId?: string) => {
    const params = new URLSearchParams()
    if (date) params.set('date', date)
    if (circleId) params.set('circleId', circleId)
    const query = params.size ? `?${params.toString()}` : ''
    return request<{ date: string; count: number; attendance: SupervisorStudentAttendanceRow[] }>(
      `/api/v1/supervisor/attendance/students${query}`)
  },
  teacherRequests: () => request<{ count: number; requests: AttendanceRequest[] }>('/api/v1/teacher/requests'),
  createTeacherRequest: (payload: CreateAttendanceRequest) =>
    request<{ id: string; status: string }>('/api/v1/teacher/requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  cancelTeacherRequest: (id: string) =>
    request<{ id: string; status: string }>(`/api/v1/teacher/requests/${id}/cancel`, { method: 'POST' }),
  supervisorRequests: (status = 'pending') =>
    request<{ count: number; requests: SupervisorAttendanceRequest[] }>(`/api/v1/supervisor/requests?status=${encodeURIComponent(status)}`),
  reviewRequest: (id: string, approve: boolean, note: string) =>
    request<{ id: string; status: string }>(`/api/v1/supervisor/requests/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ approve, note }),
    }),
  whatsapp: (recipientType: 'teacher' | 'student_guardian', recipientId: string, templateKey: string) =>
    request<{ href: string; phone: string }>('/api/v1/supervisor/communications/whatsapp', {
      method: 'POST',
      body: JSON.stringify({ recipientType, recipientId, templateKey }),
    }),
}
