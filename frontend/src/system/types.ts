import type { Branding } from '../domain/types'

export type AdminSettings = Branding & {
  trashRetentionDays: number
  whatsappTemplateAbsence: string
  whatsappTemplateUnpaid: string
  whatsappTemplateTeacherFollowup: string
  whatsappTemplateStudentFollowup: string
  teacherNotesBanner: string
  teacherNotesBannerActive: boolean
  updatedAt?: string
}

export type AdminNotification = {
  id: string
  category: string
  status: 'open' | 'resolved'
  severity: 'info' | 'warning' | 'critical' | string
  title: string
  body: string
  actionUrl: string | null
  createdAt: string
  resolvedAt: string | null
  resolutionNote: string | null
  readAt: string | null
}

export type AdminNotificationsResponse = {
  counts: { open: number; unread: number; resolved: number }
  notifications: AdminNotification[]
}

export type AdminTeacherNote = {
  kind: 'session' | 'student'
  teacherId: string
  teacherName: string
  circleName: string
  date: string
  note: string
  markedAt: string
  studentName: string | null
  studentCode: string | null
}

export type AdminTeacherNotesResponse = {
  count: number
  notes: AdminTeacherNote[]
  teachers: { id: string; name: string }[]
  banner: string | null
}

export type AuditRecord = {
  id: number
  actorName: string
  actionCode: string
  entityType: string
  entityId: string | null
  occurredAt: string
  details: unknown
  beforeData: unknown
  afterData: unknown
  canRestore: boolean
  restoredAt: string | null
}

export type TrashRecord = {
  id: string
  entityType: string
  entityId: string
  displayName: string
  deletedByName: string
  deletedAt: string
  expiresAt: string
  purgeError: string | null
}

export type BackupRecord = {
  id: string
  fileName: string
  scopes: string
  format: string
  status: string
  sizeBytes: number | null
  startedAt: string
  completedAt: string | null
  createdByName: string
  errorMessage: string | null
}

export type ResetType =
  | 'all'
  | 'student'
  | 'teacher'
  | 'circle'
  | 'teacher-attendance'
  | 'student-attendance'
  | 'schedule-slot'
  | 'monthly-charge'
  | 'payment'
  | 'advertising-expense'
  | 'operating-expense'
  | 'collection-report'

export type ResetCandidate = { id: string; label: string }

export type ResetCandidates = {
  teacherAttendance: ResetCandidate[]
  studentAttendance: ResetCandidate[]
  scheduleSlots: ResetCandidate[]
  monthlyCharges: ResetCandidate[]
  payments: ResetCandidate[]
  advertisingExpenses: ResetCandidate[]
  operatingExpenses: ResetCandidate[]
  generalOperatingExpenses: ResetCandidate[]
  collectionReports: ResetCandidate[]
}
