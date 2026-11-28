import { request } from '../services/apiClient'
import type {
  LiveKitRoomInfo,
  RoomAccessMode,
  RoomMetaResponse,
  RoomParticipantRecord,
  RoomTokenResponse,
} from './roomTypes'

export const roomApi = {
  openCircleRoom: (payload: {
    circleId: string
    sessionId?: string | null
    title?: string
    accessMode?: RoomAccessMode
    waitingRoomEnabled?: boolean
    allowStudentScreenshare?: boolean
  }) => request<LiveKitRoomInfo>('/api/v1/rooms/open', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),

  getCircleRoom: (circleId: string) =>
    request<LiveKitRoomInfo>(`/api/v1/rooms/circle/${circleId}`),

  getMeta: (inviteCode: string) =>
    request<RoomMetaResponse>(`/api/v1/rooms/${encodeURIComponent(inviteCode)}`),

  requestToken: (inviteCode: string) =>
    request<RoomTokenResponse>(`/api/v1/rooms/${encodeURIComponent(inviteCode)}/token`, {
      method: 'POST',
    }),

  listParticipants: (inviteCode: string) =>
    request<{ participants: RoomParticipantRecord[] }>(`/api/v1/rooms/${encodeURIComponent(inviteCode)}/participants`),

  updateAccess: (
    inviteCode: string,
    payload: { accessMode: RoomAccessMode; waitingRoomEnabled: boolean; allowStudentScreenshare: boolean },
  ) => request<LiveKitRoomInfo>(`/api/v1/rooms/${encodeURIComponent(inviteCode)}/access`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }),

  hostAction: (
    inviteCode: string,
    action: 'mute' | 'unmute' | 'remove' | 'ban' | 'admit' | 'deny',
    targetUserId: string,
  ) => request<{ ok: boolean }>(`/api/v1/rooms/${encodeURIComponent(inviteCode)}/moderate`, {
    method: 'POST',
    body: JSON.stringify({ action, targetUserId }),
  }),

  endRoom: (inviteCode: string) =>
    request<{ ok: boolean }>(`/api/v1/rooms/${encodeURIComponent(inviteCode)}/end`, {
      method: 'POST',
    }),

  attendanceEvent: (inviteCode: string, kind: 'join' | 'heartbeat' | 'leave') =>
    request<{ ok: boolean; attendedSeconds: number }>(
      `/api/v1/rooms/${encodeURIComponent(inviteCode)}/attendance/${kind}`,
      { method: 'POST' },
    ),

  sessionSuggestedAttendance: (sessionId: string) =>
    request<{
      roomId: string | null
      teacherAttendedMinutes: number
      students: { studentId: string; userId: string; attendedMinutes: number; suggestedStatus: 'present' | 'absent' }[]
    }>(`/api/v1/rooms/session/${sessionId}/attendance-suggestions`),
}
