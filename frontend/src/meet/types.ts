/** Contracts mirrored from Dar.Modules.Meet (camelCase JSON). */
export type MeetRecordingMode = 'inherit' | 'force' | 'exclude'
export type MeetFilter = 'all' | 'linked' | 'unlinked' | 'recording' | 'cancelled'

export type MeetCalendarStatus = {
  moduleConfigured: boolean
  missingPrerequisites: string[]
  connected: boolean
  accountEmail: string | null
  calendarId: string | null
  status: string | null
  lastSyncAt: string | null
  lastFullSyncAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  consecutiveFailures: number
}

export type MeetSyncResult = {
  ok: boolean
  fullResync: boolean
  added: number
  updated: number
  cancelled: number
  autoLinked: number
  syncedAt: string | null
  message: string | null
}

export type MeetEvent = {
  id: string
  googleEventId: string
  summary: string | null
  meetLink: string | null
  htmlLink: string | null
  startsAt: string
  endsAt: string
  timeZone: string | null
  googleStatus: 'confirmed' | 'tentative' | 'cancelled' | string
  isRecurring: boolean
  recordingMode: MeetRecordingMode
  circleId: string | null
  circleName: string | null
  linkedAutomatically: boolean
  suggestedCircleId: string | null
  suggestedCircleName: string | null
  suggestedConfidence: number
  recordingEligible: boolean
  /** per-event access override; null inherits the module default. */
  accessType?: 'open' | 'trusted' | null
}

export type MeetEventPage = {
  from: string
  to: string
  page: number
  pageSize: number
  total: number
  items: MeetEvent[]
  nextCursor: string | null
}

export type MeetCircleSetting = {
  circleId: string
  name: string
  isActive: boolean
  autoRecord: boolean
  autoLink: boolean
  upcomingLinkedEvents: number
}

export type MeetCirclesResponse = { scoped: boolean; circles: MeetCircleSetting[] }

export type MeetSettings = {
  recordingEnabled: boolean
  joinLeadSeconds: number
  stopGraceSeconds: number
  maxConcurrentSessions: number
  diskBlockGb: number
  diskWarnGb: number
  uploadBwLimit: string
  hlsRetentionHours: number
  defaultAccessType: 'open' | 'trusted'
  maxSessionMinutes: number
}

export type MeetConnectResponse = { authorizationUrl: string }

export type MeetSession = {
  id: string
  summary: string | null
  circleName: string | null
  startedAt: string
  durationSeconds: number | null
  status: 'live' | 'finalizing' | 'uploading' | 'ready' | 'partial' | 'failed' | string
  sizeBytes: number | null
  uploadedToDrive: boolean
  streamUrl: string | null
  posterUrl: string | null
}

export type MeetSessionsResponse = { count: number; sessions: MeetSession[] }

export type MeetActiveJob = {
  active: boolean
  id?: string
  status?: string
  summary?: string | null
  meetLink?: string | null
  startedAt?: string | null
  scheduledEnd?: string
  participants?: number | null
  paused?: boolean
  stopRequested?: boolean
}

export type MeetAlert = {
  id: string
  severity: 'info' | 'warning' | 'critical'
  code: string
  title: string
  body: string | null
  createdAt: string
  isRead: boolean
}

export type MeetAlertsResponse = { count: number; unread: number; alerts: MeetAlert[] }
