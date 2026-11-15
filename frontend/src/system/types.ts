import type { Branding } from '../domain/types'

export type AdminSettings = Branding & { trashRetentionDays: number; updatedAt?: string }

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
