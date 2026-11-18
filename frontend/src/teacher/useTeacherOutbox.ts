import { useCallback, useEffect, useState } from 'react'
import { teacherApi, TeacherApiError } from './teacherApi'
import { listQueuedAttendance, queueAttendance, removeQueuedAttendance, type QueuedAttendanceMark } from './offlineOutbox'
import type { TeacherSession } from './teacherTypes'

/** Queues teacher attendance on the device when the network is unavailable and flushes it later. */
export function useTeacherOutbox(session: TeacherSession | null) {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine)
  const [pending, setPending] = useState(0)

  const refresh = useCallback(async () => {
    try { setPending((await listQueuedAttendance()).length) } catch { /* IndexedDB is optional */ }
  }, [])

  const flush = useCallback(async () => {
    if (!session || !navigator.onLine) return
    const items = await listQueuedAttendance().catch(() => [])
    for (const item of items) {
      try {
        await teacherApi.submit(item.sessionId, item.marks)
        await removeQueuedAttendance(item.sessionId)
      } catch (err) {
        if (err instanceof TeacherApiError && err.status >= 400 && err.status < 500) {
          await removeQueuedAttendance(item.sessionId)
          continue
        }
        break
      }
    }
    await refresh()
  }, [session, refresh])

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    void refresh()
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [refresh])

  useEffect(() => {
    if (online && session) void flush()
  }, [online, session, flush])

  const enqueue = useCallback(async (sessionId: string, marks: QueuedAttendanceMark[]) => {
    await queueAttendance(sessionId, marks)
    await refresh()
  }, [refresh])

  return { online, pending, enqueue, flush }
}
