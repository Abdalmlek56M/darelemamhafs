import { api } from '../system/api'
import type {
  MeetCalendarStatus,
  MeetCircleSetting,
  MeetCirclesResponse,
  MeetConnectResponse,
  MeetEvent,
  MeetEventPage,
  MeetFilter,
  MeetRecordingMode,
  MeetActiveJob,
  MeetAlertsResponse,
  MeetSessionsResponse,
  MeetSettings,
  MeetSyncResult,
} from './types'

type EventsQuery = {
  from: string
  to: string
  filter: MeetFilter
  search: string
  page: number
  pageSize: number
  /** false shows events without a Meet link (Zoom imports etc.); the default hides them. */
  meetOnly?: boolean
}

function eventQuery(params: EventsQuery) {
  const query = new URLSearchParams({
    from: params.from,
    to: params.to,
    filter: params.filter,
    page: String(params.page),
    pageSize: String(params.pageSize),
  })
  if (params.search.trim()) query.set('search', params.search.trim())
  if (params.meetOnly === false) query.set('meetOnly', 'false')
  return query.toString()
}

/** REST client for /api/v1/meet (admin cookies are bridged by ADR-0006). */
export const meetApi = {
  status: () => api<MeetCalendarStatus>('/api/v1/meet/calendar/status'),

  connect: () => api<MeetConnectResponse>('/api/v1/meet/calendar/connect', { method: 'POST' }),

  sync: (full = false) =>
    api<MeetSyncResult>(`/api/v1/meet/calendar/sync${full ? '?full=true' : ''}`, { method: 'POST' }),

  disconnect: () => api<{ ok: boolean }>('/api/v1/meet/calendar/disconnect', { method: 'POST' }),

  events: (params: EventsQuery) => api<MeetEventPage>(`/api/v1/meet/events?${eventQuery(params)}`),

  createEvent: (body: {
    circleId: string
    title: string
    date: string
    startTime: string
    durationMinutes: number
    description?: string | null
  }) =>
    api<{ id: string; meetLink: string | null; htmlLink: string | null; startsAt: string; endsAt: string }>(
      '/api/v1/meet/events',
      { method: 'POST', body: JSON.stringify(body) }
    ),

  link: (eventId: string, circleId: string, enableRecording: boolean) =>
    api<MeetEvent>(`/api/v1/meet/events/${eventId}/link`, {
      method: 'PUT',
      body: JSON.stringify({ circleId, enableRecording }),
    }),

  unlink: (eventId: string) =>
    api<{ ok: boolean }>(`/api/v1/meet/events/${eventId}/link`, { method: 'DELETE' }),

  setRecordingMode: (eventId: string, mode: MeetRecordingMode) =>
    api<MeetEvent>(`/api/v1/meet/events/${eventId}/recording`, {
      method: 'PUT',
      body: JSON.stringify({ mode }),
    }),

  circles: () => api<MeetCirclesResponse>('/api/v1/meet/circles'),

  sessions: () => api<MeetSessionsResponse>('/api/v1/meet/sessions?limit=50'),

  botJoin: (url: string, title?: string) =>
    api<{ jobId: string; meetLink: string; message: string }>('/api/v1/meet/bot/join', {
      method: 'POST',
      body: JSON.stringify({ url, title: title ?? null }),
    }),

  botActive: () => api<MeetActiveJob>('/api/v1/meet/bot/active'),

  botStop: (jobId: string) =>
    api<{ message: string }>(`/api/v1/meet/jobs/${jobId}/stop`, { method: 'POST' }),

  botPause: (jobId: string, paused: boolean) =>
    api<{ paused: boolean }>(`/api/v1/meet/jobs/${jobId}/pause`, {
      method: 'POST',
      body: JSON.stringify({ paused }),
    }),

  alerts: (limit = 20) => api<MeetAlertsResponse>(`/api/v1/meet/alerts?limit=${limit}`),

  markAlertsRead: (id?: string) =>
    api<{ updated: number }>('/api/v1/meet/alerts/read', {
      method: 'POST',
      body: JSON.stringify({ id: id ?? null }),
    }),

  saveCircle: (circleId: string, autoRecord: boolean, autoLink: boolean) =>
    api<MeetCircleSetting>(`/api/v1/meet/circles/${circleId}`, {
      method: 'PUT',
      body: JSON.stringify({ autoRecord, autoLink }),
    }),

  settings: () => api<MeetSettings>('/api/v1/meet/settings'),
}
