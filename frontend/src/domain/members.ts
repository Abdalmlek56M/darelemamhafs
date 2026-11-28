import type { AdminUser, Student, Teacher } from './types'
import { statusLabels, teacherStatusLabels } from './labels'

export type MemberKind = 'student' | 'guardian' | 'teacher' | 'supervisor'
export type MemberTypeFilter = 'all' | MemberKind

export const memberKindLabels: Record<MemberKind, string> = {
  student: 'طالب',
  guardian: 'ولي أمر',
  teacher: 'معلمة',
  supervisor: 'مشرفة',
}

export type MemberProfileTarget =
  | { kind: 'student'; student: Student }
  | { kind: 'guardian'; studentId: string }
  | { kind: 'teacher'; teacher: Teacher }
  | { kind: 'supervisor'; user: AdminUser }

export type UnifiedMember = {
  key: string
  kind: MemberKind
  name: string
  codeOrUsername: string
  phone: string | null
  subtitle: string
  statusLabel: string
  statusClass: string
  target: MemberProfileTarget
}

export function isSupervisorUser(user: AdminUser): boolean {
  return user.permissionCodes.some((code) => code.startsWith('supervisor.'))
}

export function buildUnifiedMembers(
  students: Student[],
  teachers: Teacher[],
  users: AdminUser[],
): UnifiedMember[] {
  const members: UnifiedMember[] = []
  const seenGuardians = new Map<string, {
    key: string
    name: string
    phone: string | null
    firstStudentId: string
    studentNames: string[]
  }>()

  for (const student of students) {
    members.push({
      key: `student:${student.id}`,
      kind: 'student',
      name: student.fullName,
      codeOrUsername: student.studentCode,
      phone: student.phone,
      subtitle: student.circleNames || 'غير ملتحق بحلقة',
      statusLabel: statusLabels[student.status] ?? student.status,
      statusClass: `status-${student.status}`,
      target: { kind: 'student', student },
    })

    const gName = student.guardianName?.trim() || ''
    const gPhone = student.guardianPhone?.trim() || ''
    if (gName || gPhone) {
      const guardianKey = `${gName.toLowerCase()}|${gPhone}`
      const existing = seenGuardians.get(guardianKey)
      if (existing) {
        existing.studentNames.push(student.fullName)
      } else {
        seenGuardians.set(guardianKey, {
          key: `guardian:${guardianKey}:${student.id}`,
          name: gName || 'ولي أمر',
          phone: gPhone || null,
          firstStudentId: student.id,
          studentNames: [student.fullName],
        })
      }
    }
  }

  for (const guardian of seenGuardians.values()) {
    members.push({
      key: guardian.key,
      kind: 'guardian',
      name: guardian.name,
      codeOrUsername: 'ولي أمر',
      phone: guardian.phone,
      subtitle: `الطالب: ${guardian.studentNames.join('، ')}`,
      statusLabel: `${guardian.studentNames.length} طالب`,
      statusClass: 'status-active',
      target: { kind: 'guardian', studentId: guardian.firstStudentId },
    })
  }

  for (const teacher of teachers) {
    members.push({
      key: `teacher:${teacher.id}`,
      kind: 'teacher',
      name: teacher.fullName,
      codeOrUsername: teacher.teacherCode,
      phone: teacher.phone,
      subtitle: teacher.circleNames || 'غير مسندة لحلقات',
      statusLabel: teacherStatusLabels[teacher.status] ?? teacher.status,
      statusClass: teacher.status === 'active'
        ? 'status-active'
        : teacher.status === 'inactive'
          ? 'status-paused'
          : 'status-archived',
      target: { kind: 'teacher', teacher },
    })
  }

  for (const user of users) {
    if (!isSupervisorUser(user)) continue
    members.push({
      key: `supervisor:${user.id}`,
      kind: 'supervisor',
      name: user.displayName,
      codeOrUsername: `@${user.username}`,
      phone: null,
      subtitle: `${user.permissionCodes.length} صلاحية`,
      statusLabel: user.isActive ? 'نشطة' : 'معطّلة',
      statusClass: user.isActive ? 'status-active' : 'status-archived',
      target: { kind: 'supervisor', user },
    })
  }

  return members
}

export function filterUnifiedMembers(
  members: UnifiedMember[],
  typeFilter: MemberTypeFilter,
  search: string,
): UnifiedMember[] {
  const needle = search.trim().toLowerCase()
  return members.filter((member) => {
    if (typeFilter !== 'all' && member.kind !== typeFilter) return false
    if (!needle) return true
    return [member.name, member.codeOrUsername, member.phone ?? '', member.subtitle, memberKindLabels[member.kind]]
      .some((value) => value.toLowerCase().includes(needle))
  })
}
