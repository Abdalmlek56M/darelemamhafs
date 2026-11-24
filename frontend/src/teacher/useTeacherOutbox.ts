import { useCallback, useEffect, useRef, useState } from 'react'
import { teacherApi, TeacherApiError } from './teacherApi'
import {
  backoffRetryDelayMs,
  classifyOutboxFailure,
} from './outboxPolicy'
import {
  claimLegacyAttendance,
  clearNeedsReview,
  listLegacyAttendance,
  listQueuedAttendance,
  queueAttendance,
  recordQueuedFailure,
  removeQueuedAttendance,
  type QueuedAttendanceMark,
} from './offlineOutbox'
import type { TeacherSession } from './teacherTypes'

/**
 * Queues teacher attendance on the device when the network is unavailable and flushes it later.
 * P0-4: failures are never deleted silently. 401 stays queued until the next sign-in, transient
 * errors retry with backoff, and other 4xx responses are kept for an explicit teacher decision.
 */
export function useTeacherOutbox(session: TeacherSession | null) {
  const userId = session?.id ?? null
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine)
  const [pending, setPending] = useState(0)
  const [needsReview, setNeedsReview] = useState(0)
  const [legacy, setLegacy] = useState(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushRef = useRef<(force?: boolean) => Promise<void>>(async () => {})

  const clearTimer = useCallback(() => {
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null }
  }, [])

  const refresh = useCallback(async () => {
    // Legacy v1 rows are shown even before a user is selected; they are never auto-sent.
    try { setLegacy((await listLegacyAttendance()).length) } catch { setLegacy(0) }
    if (!userId) { setPending(0); setNeedsReview(0); setLastError(null); return }
    try {
      const items = await listQueuedAttendance(userId)
      setPending(items.length)
      setNeedsReview(items.filter(item => item.needsReview).length)
      setLastError(items.find(item => item.lastError)?.lastError ?? null)
    } catch { /* IndexedDB is optional */ }
  }, [userId])

  const scheduleRetry = useCallback((attempts: number) => {
    clearTimer()
    retryTimer.current = setTimeout(() => { retryTimer.current = null; void flushRef.current() }, backoffRetryDelayMs(attempts))
  }, [clearTimer])

  const flush = useCallback(async (force = false) => {
    if (!userId || !navigator.onLine) return
    const items = await listQueuedAttendance(userId).catch(() => [])
    let retryAttempts = 0
    for (const item of items) {
      if (item.needsReview && !force) continue
      try {
        await teacherApi.submit(item.sessionId, item.marks)
        await removeQueuedAttendance(userId, item.sessionId)
      } catch (err) {
        const status = err instanceof TeacherApiError ? err.status : undefined
        const decision = classifyOutboxFailure(status)
        const message = err instanceof Error ? err.message : 'تعذر إرسال الحضور.'
        if (decision === 'needs-review') {
          await recordQueuedFailure(userId, item.sessionId, message, true).catch(() => {})
          continue
        }
        await recordQueuedFailure(userId, item.sessionId, message, false).catch(() => {})
        if (decision === 'retry') retryAttempts = Math.max(retryAttempts, item.attempts + 1)
        // 401 keeps the item and waits for the next sign-in; any retry path pauses this pass.
        break
      }
    }
    await refresh()
    if (retryAttempts > 0) scheduleRetry(retryAttempts)
  }, [userId, refresh, scheduleRetry])
  flushRef.current = flush

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (online && userId) void flush()
  }, [online, userId, flush])

  useEffect(() => {
    clearTimer()
    return clearTimer
  }, [clearTimer])

  const enqueue = useCallback(async (sessionId: string, marks: QueuedAttendanceMark[]) => {
    if (!userId) throw new Error('لا توجد جلسة معلمة.')
    await queueAttendance(userId, sessionId, marks)
    await refresh()
  }, [userId, refresh])

  const retryAll = useCallback(async () => {
    if (!userId) return
    await clearNeedsReview(userId).catch(() => {})
    await flush(true)
  }, [userId, flush])

  const claimLegacy = useCallback(async () => {
    if (!userId) return
    const claimed = await claimLegacyAttendance(userId).catch(() => 0)
    await refresh()
    if (claimed > 0) await flush(true)
  }, [userId, refresh, flush])

  return { online, pending, needsReview, legacy, lastError, enqueue, flush, retryAll, claimLegacy }
}
