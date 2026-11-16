import type {
  AttendanceMark, EarningsResponse, EndResponse, NotificationsResponse, RosterResponse,
  StartResponse, SubscriptionsResponse, SupervisorAbsencesResponse, SupervisorLiveResponse,
  SupervisorUnpaidResponse, TeacherSession, TodayResponse,
} from './teacherTypes'

export class TeacherApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function readError(response: Response) {
  try {
    const body = await response.json()
    if (typeof body.message === 'string') return body.message
    if (typeof body.detail === 'string') return body.detail
    if (body.errors && typeof body.errors === 'object') {
      return Object.values(body.errors).flat().join(' ')
    }
  } catch { /* use the status fallback */ }
  if (response.status === 401) return 'انتهت الجلسة. سجّلي الدخول مرة أخرى.'
  if (response.status === 403) return 'لا تملك صلاحية لهذا الإجراء.'
  return `تعذر تنفيذ الطلب (HTTP ${response.status}).`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers, credentials: 'include', cache: 'no-store' })
  if (!response.ok) throw new TeacherApiError(await readError(response), response.status)
  if (response.status === 204) return undefined as T
  return await response.json() as T
}

export const teacherApi = {
  me: () => request<TeacherSession>('/api/v1/auth/me'),
  login: (username: string, password: string, rememberMe: boolean) =>
    request<TeacherSession>('/api/v1/auth/password', {
      method: 'POST',
      body: JSON.stringify({ username, password, rememberMe }),
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
}
