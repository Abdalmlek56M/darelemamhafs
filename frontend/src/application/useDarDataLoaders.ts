import { useCallback } from 'react'
import type {
  AdminUser,
  AdExpense,
  AttendanceRow,
  Circle,
  CollectionRow,
  Notice,
  OperatingExpense,
  Permission,
  SavedReport,
  ScheduleSlot,
  Session,
  Student,
  StudentAttendanceSummary,
  Teacher,
} from '../domain/types'
import { request } from '../services/apiClient'

type HealthState = 'checking' | 'connected' | 'down'

type DarDataLoadersOptions = {
  session: Session | null
  currentMonthValue: string
  busy: boolean
  setBusy: (value: boolean) => void
  setToast: (notice: Notice) => void
  setHealth: (value: HealthState) => void
  setStudents: (value: Student[]) => void
  setTeachers: (value: Teacher[]) => void
  setCircles: (value: Circle[]) => void
  setScheduleSlots: (value: ScheduleSlot[]) => void
  setAttendanceRows: (value: AttendanceRow[]) => void
  setStudentAttendanceSummaries: (value: StudentAttendanceSummary[]) => void
  setAdvertisingExpenses: (value: AdExpense[]) => void
  setOperatingExpenses: (value: OperatingExpense[]) => void
  setCollections: (value: CollectionRow[]) => void
  setReports: (value: SavedReport[]) => void
  setUsers: (value: AdminUser[]) => void
  setPermissions: (value: Permission[]) => void
}

/**
 * Data loaders for the legacy dashboard. Every loader is permission-gated
 * here as well as on the API, so the UI never renders data the session
 * cannot read. `refreshAll` aggregates settled results and surfaces the
 * first failure instead of aborting the whole refresh.
 */
export default function useDarDataLoaders({
  session,
  currentMonthValue,
  busy,
  setBusy,
  setToast,
  setHealth,
  setStudents,
  setTeachers,
  setCircles,
  setScheduleSlots,
  setAttendanceRows,
  setStudentAttendanceSummaries,
  setAdvertisingExpenses,
  setOperatingExpenses,
  setCollections,
  setReports,
  setUsers,
  setPermissions,
}: DarDataLoadersOptions) {
  const checkHealth = useCallback(async () => {
    try {
      const result = await request<{ status: string; database: string }>('/health')
      setHealth(result.database === 'connected' ? 'connected' : 'down')
    } catch { setHealth('down') }
  }, [setHealth])

  const loadStudents = useCallback(async () => {
    if (!session?.permissionCodes.includes('students.read')) return
    setStudents(await request<Student[]>('/api/students'))
  }, [session, setStudents])

  const loadTeachers = useCallback(async () => {
    if (!session?.permissionCodes.includes('teachers.read')) return
    setTeachers(await request<Teacher[]>('/api/teachers'))
  }, [session, setTeachers])

  const loadCircles = useCallback(async () => {
    if (!session?.permissionCodes.includes('circles.read')) return
    setCircles(await request<Circle[]>('/api/circles'))
  }, [session, setCircles])

  const loadScheduleSlots = useCallback(async () => {
    if (!session?.permissionCodes.some(code => ['schedule.read', 'schedule.edit', 'attendance.read', 'attendance.edit'].includes(code))) return
    setScheduleSlots(await request<ScheduleSlot[]>('/api/schedule-slots'))
  }, [session, setScheduleSlots])

  const loadAttendance = useCallback(async (month = currentMonthValue) => {
    if (!session?.permissionCodes.some(code => code === 'attendance.read' || code === 'attendance.edit')) return
    const [teacherRows, studentSummaries] = await Promise.all([
      request<AttendanceRow[]>(`/api/teacher-attendance?month=${encodeURIComponent(month)}`),
      request<StudentAttendanceSummary[]>(`/api/student-attendance/session-summary?month=${encodeURIComponent(month)}`)
        .catch(() => [] as StudentAttendanceSummary[]),
    ])
    setAttendanceRows(teacherRows)
    setStudentAttendanceSummaries(studentSummaries)
  }, [session, currentMonthValue, setAttendanceRows, setStudentAttendanceSummaries])

  const loadAdvertisingExpenses = useCallback(async (month = currentMonthValue) => {
    if (!session?.permissionCodes.includes('finance.read')) return
    setAdvertisingExpenses(await request<AdExpense[]>(`/api/advertising-expenses?month=${encodeURIComponent(month)}`))
  }, [session, currentMonthValue, setAdvertisingExpenses])

  const loadOperatingExpenses = useCallback(async (month = currentMonthValue) => {
    if (!session?.permissionCodes.includes('finance.read')) return
    setOperatingExpenses(await request<OperatingExpense[]>(`/api/operating-expenses?month=${encodeURIComponent(month)}`))
  }, [session, currentMonthValue, setOperatingExpenses])

  const loadCollections = useCallback(async (month = currentMonthValue) => {
    if (!session?.permissionCodes.includes('finance.read')) return
    setCollections(await request<CollectionRow[]>(`/api/collections?month=${encodeURIComponent(month)}`))
  }, [session, currentMonthValue, setCollections])

  const loadReports = useCallback(async (month = currentMonthValue) => {
    if (!session?.permissionCodes.includes('finance.read')) return
    setReports(await request<SavedReport[]>(`/api/collection-reports?month=${encodeURIComponent(month)}`))
  }, [session, currentMonthValue, setReports])

  const loadUsers = useCallback(async () => {
    if (!session?.permissionCodes.includes('users.manage')) return
    const [accountRows, permissionRows] = await Promise.all([
      request<AdminUser[]>('/api/admin/users'),
      request<Permission[]>('/api/admin/permissions'),
    ])
    setUsers(accountRows)
    setPermissions(permissionRows)
  }, [session, setUsers, setPermissions])

  const refreshAll = useCallback(async () => {
    if (busy) return
    const refreshStartedAt = Date.now()
    setBusy(true)
    const jobs: Promise<unknown>[] = [checkHealth()]
    if (session?.permissionCodes.includes('students.read')) jobs.push(loadStudents())
    if (session?.permissionCodes.includes('teachers.read')) jobs.push(loadTeachers())
    if (session?.permissionCodes.includes('circles.read')) jobs.push(loadCircles())
    if (session?.permissionCodes.some(code => ['schedule.read', 'schedule.edit', 'attendance.read', 'attendance.edit'].includes(code))) jobs.push(loadScheduleSlots())
    if (session?.permissionCodes.some(code => code === 'attendance.read' || code === 'attendance.edit')) jobs.push(loadAttendance())
    if (session?.permissionCodes.includes('finance.read')) {
      jobs.push(loadCollections())
      jobs.push(loadReports())
      jobs.push(loadAdvertisingExpenses())
      jobs.push(loadOperatingExpenses())
    }
    if (session?.permissionCodes.includes('users.manage')) jobs.push(loadUsers())
    try {
      const results = await Promise.allSettled(jobs)
      const failures = results.filter(result => result.status === 'rejected') as PromiseRejectedResult[]
      if (failures.length) {
        setToast({
          tone: 'error',
          text: failures[0].reason instanceof Error ? failures[0].reason.message : 'تعذر تحديث بعض البيانات.',
        })
      }
    } finally {
      const visibleDuration = Date.now() - refreshStartedAt
      if (visibleDuration < 1150) await new Promise(resolve => window.setTimeout(resolve, 1150 - visibleDuration))
      setBusy(false)
    }
  }, [busy, checkHealth, loadStudents, loadTeachers, loadCircles, loadScheduleSlots, loadAttendance, loadAdvertisingExpenses, loadOperatingExpenses, loadCollections, loadReports, loadUsers, session, setBusy, setToast])

  return {
    checkHealth,
    loadStudents,
    loadTeachers,
    loadCircles,
    loadScheduleSlots,
    loadAttendance,
    loadAdvertisingExpenses,
    loadOperatingExpenses,
    loadCollections,
    loadReports,
    loadUsers,
    refreshAll,
  }
}
