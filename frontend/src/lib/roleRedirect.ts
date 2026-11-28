const ADMIN_PERMISSIONS = [
  'dashboard.read',
  'students.read',
  'teachers.read',
  'circles.read',
  'schedule.read',
  'attendance.read',
  'finance.read',
  'users.manage',
  'settings.manage',
]

export type PortalPath = '/management' | '/supervisor' | '/teacher' | '/portal'

/**
 * Resolves the target portal path for an authenticated user based on their permissions.
 * Priority: management/admin -> supervisor -> teacher -> /portal (guardian/student coming-soon).
 */
export function resolvePortalPath(permissionCodes: readonly string[]): PortalPath {
  if (ADMIN_PERMISSIONS.some((code) => permissionCodes.includes(code))) {
    return '/management'
  }
  if (permissionCodes.some((code) => code === 'supervisor.portal' || code.startsWith('supervisor.'))) {
    return '/supervisor'
  }
  if (permissionCodes.some((code) => code === 'teacher.portal' || code.startsWith('teacher.'))) {
    return '/teacher'
  }
  return '/portal'
}
