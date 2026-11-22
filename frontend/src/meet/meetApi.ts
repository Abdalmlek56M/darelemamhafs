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

  saveCircle: (circleId: string, autoRecord: boolean, autoLink: boolean) =>
    api<MeetCircleSetting>(`/api/v1/meet/circles/${circleId}`, {
      method: 'PUT',
      body: JSON.stringify({ autoRecord, autoLink }),
    }),

  settings: () => api<MeetSettings>('/api/v1/meet/settings'),
}
