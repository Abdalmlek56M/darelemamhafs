import type { Track } from 'livekit-client'

export type RoomRole = 'host' | 'participant'
export type AdmissionStatus = 'pending' | 'admitted' | 'denied' | 'banned'
export type RoomAccessMode = 'private' | 'public'

export type LiveKitRoomInfo = {
  id: string
  roomName: string
  inviteCode: string
  invitePath: string
  circleId: string
  circleName: string
  isChildren: boolean
  sessionId: string | null
  title: string
  accessMode: RoomAccessMode
  waitingRoomEnabled: boolean
  allowStudentScreenshare: boolean
  onlyHostCanUnmute: boolean
  status: 'open' | 'ended'
  createdAt: string
}

export type RoomMetaResponse = {
  enabled: boolean
  room: LiveKitRoomInfo
  role: RoomRole
  admissionStatus: AdmissionStatus
  mutedByHost: boolean
}

export type RoomTokenResponse = {
  admitted: boolean
  admissionStatus: AdmissionStatus
  token?: string
  url?: string
  roomName?: string
  role: RoomRole
  onlyHostCanUnmute?: boolean
  allowStudentScreenshare?: boolean
  mutedByHost?: boolean
  room: LiveKitRoomInfo
}

export type RoomParticipantRecord = {
  userId: string
  username: string
  displayName: string
  role: RoomRole
  admissionStatus: AdmissionStatus
  mutedByHost: boolean
  firstJoinedAt: string | null
  lastJoinedAt: string | null
  lastLeftAt: string | null
  attendedSeconds: number
  attendedMinutes: number
  isConnected: boolean
}

export type LiveParticipantTile = {
  identity: string
  name: string
  isLocal: boolean
  isHost: boolean
  micEnabled: boolean
  cameraEnabled: boolean
  screenEnabled: boolean
  videoTrack: Track | null
  screenTrack: Track | null
  audioTrack: Track | null
}

export type RoomChatMessage = {
  id: string
  senderIdentity: string
  senderName: string
  text: string
  sentAt: string
}

export type RoomReaction = {
  id: string
  senderName: string
  emoji: string
}

export type WhiteboardStroke = {
  id: string
  points: number[]
  color: string
  width: number
}

export type RoomDataPacket =
  | { type: 'chat'; id: string; senderName: string; text: string; sentAt: string }
  | { type: 'hand'; raised: boolean }
  | { type: 'reaction'; id: string; senderName: string; emoji: string }
  | { type: 'wb-stroke'; stroke: WhiteboardStroke }
  | { type: 'wb-clear' }
  | { type: 'wb-state'; open: boolean }
  | { type: 'wb-sync-request' }
  | { type: 'wb-sync'; open: boolean; strokes: WhiteboardStroke[] }
  | { type: 'host-mute'; targetIdentity: string; muted: boolean }
