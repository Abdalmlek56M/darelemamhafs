/** Offline outbox for teacher attendance only. Never stores money or roster names. */
export type QueuedAttendanceMark = { enrollmentId: string; status: 'present' | 'excused' | 'absent' }
export type QueuedAttendance = {
  id: string
  userId: string
  sessionId: string
  marks: QueuedAttendanceMark[]
  queuedAt: string
  attempts: number
  lastError: string | null
  needsReview: boolean
}

/** Rows copied from the v1 store are not assigned to any account until a teacher claims them. */
export const LEGACY_USER_ID = '__legacy__'
export const LEGACY_LAST_ERROR = 'سجل حضور قديم من نسخة سابقة — يحتاج تأكيد المستخدم.'

const dbName = 'dar-teacher-outbox'
const storeName = 'attendance-queue'
const legacyStoreName = 'attendance'
const dbVersion = 3

/** Stable queue key: attendance is per user and per teacher session. */
export function queueId(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`
}

/** Id used for rows migrated out of the v1 (sessionId-keyed) store. */
export function legacyRecordId(sessionId: string): string {
  return `legacy:${sessionId}`
}

/** A queued mark belongs to exactly one account, even on a shared device. */
export function isQueuedForUser(item: Pick<QueuedAttendance, 'userId'>, userId: string): boolean {
  return item.userId === userId
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available.')); return }
    const request = indexedDB.open(dbName, dbVersion)
    request.onupgradeneeded = event => {
      const db = request.result
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'id' })
      // P0-6: copy the old v1 store into the v2/v3 queue as unassigned legacy rows.
      // The v1 store is intentionally kept untouched; the rows are never auto-sent.
      const transaction = request.transaction
      if (transaction && event.oldVersion > 0 && event.oldVersion < 3 && db.objectStoreNames.contains(legacyStoreName)) {
        const legacyRows = transaction.objectStore(legacyStoreName)
        const queue = transaction.objectStore(storeName)
        const cursorRequest = legacyRows.openCursor()
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) return
          const value = cursor.value as Partial<{ sessionId: string; marks: QueuedAttendanceMark[]; queuedAt: string }>
          if (typeof value?.sessionId === 'string' && value.sessionId.length > 0) {
            const id = legacyRecordId(value.sessionId)
            const existing = queue.get(id)
            existing.onsuccess = () => {
              if (existing.result) return
              queue.put({
                id,
                userId: LEGACY_USER_ID,
                sessionId: value.sessionId!,
                marks: Array.isArray(value.marks) ? value.marks : [],
                queuedAt: value.queuedAt ?? new Date().toISOString(),
                attempts: 0,
                lastError: LEGACY_LAST_ERROR,
                needsReview: true,
              } satisfies QueuedAttendance)
            }
          }
          cursor.continue()
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the offline store.'))
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | void> {
  const db = await openDb()
  try {
    return await new Promise<T | void>((resolve, reject) => {
      const tx = db.transaction(storeName, mode)
      const result = run(tx.objectStore(storeName))
      let value: T | undefined
      if (result && typeof (result as IDBRequest<T>).onsuccess !== 'undefined') {
        (result as IDBRequest<T>).onsuccess = () => { value = (result as IDBRequest<T>).result }
      }
      tx.oncomplete = () => resolve(value)
      tx.onerror = () => reject(tx.error ?? new Error('Offline attendance store failed.'))
      tx.onabort = () => reject(tx.error ?? new Error('Offline attendance store was aborted.'))
    })
  } finally {
    db.close()
  }
}

export async function queueAttendance(userId: string, sessionId: string, marks: QueuedAttendanceMark[]) {
  const record: QueuedAttendance = {
    id: queueId(userId, sessionId),
    userId,
    sessionId,
    marks,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    needsReview: false,
  }
  await withStore('readwrite', store => store.put(record))
}

export async function listQueuedAttendance(userId: string): Promise<QueuedAttendance[]> {
  const rows = await withStore<QueuedAttendance[]>('readonly', store => store.getAll()) as QueuedAttendance[] | undefined
  return (rows ?? []).filter(item => isQueuedForUser(item, userId)).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
}

/** Legacy rows copied from the v1 store; they are visible but never auto-sent. */
export async function listLegacyAttendance(): Promise<QueuedAttendance[]> {
  const rows = await withStore<QueuedAttendance[]>('readonly', store => store.getAll()) as QueuedAttendance[] | undefined
  return (rows ?? []).filter(item => item.userId === LEGACY_USER_ID).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
}

/** Explicitly assign legacy rows to the signed-in teacher (never automatic). */
export async function claimLegacyAttendance(userId: string): Promise<number> {
  if (userId === LEGACY_USER_ID) return 0
  const db = await openDb()
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      let claimed = 0
      const read = store.getAll()
      read.onsuccess = () => {
        for (const item of (read.result ?? []) as QueuedAttendance[]) {
          if (item.userId !== LEGACY_USER_ID) continue
          const targetId = queueId(userId, item.sessionId)
          const existing = store.get(targetId)
          existing.onsuccess = () => {
            if (existing.result) return
            store.delete(item.id)
            store.put({
              ...item,
              id: targetId,
              userId,
              attempts: 0,
              lastError: null,
              needsReview: false,
            } satisfies QueuedAttendance)
            claimed += 1
          }
        }
      }
      tx.oncomplete = () => resolve(claimed)
      tx.onerror = () => reject(tx.error ?? new Error('Could not claim the legacy attendance.'))
      tx.onabort = () => reject(tx.error ?? new Error('Could not claim the legacy attendance.'))
    })
  } finally {
    db.close()
  }
}

export async function removeQueuedAttendance(userId: string, sessionId: string) {
  await withStore('readwrite', store => store.delete(queueId(userId, sessionId)))
}

/** Records a failed attempt without deleting the mark; keeps the last error for the UI. */
export async function recordQueuedFailure(userId: string, sessionId: string, message: string, needsReview: boolean) {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      const read = store.get(queueId(userId, sessionId))
      read.onsuccess = () => {
        const item = read.result as QueuedAttendance | undefined
        if (!item) return
        store.put({ ...item, attempts: item.attempts + 1, lastError: message, needsReview })
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Could not record the offline failure.'))
      tx.onabort = () => reject(tx.error ?? new Error('Could not record the offline failure.'))
    })
  } finally {
    db.close()
  }
}

/** Clears the needs-review flags so the teacher can retry everything explicitly. */
export async function clearNeedsReview(userId: string) {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      const read = store.getAll()
      read.onsuccess = () => {
        for (const item of (read.result ?? []) as QueuedAttendance[]) {
          if (item.userId === userId && item.needsReview) store.put({ ...item, needsReview: false, lastError: null })
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Could not reset the offline review flags.'))
      tx.onabort = () => reject(tx.error ?? new Error('Could not reset the offline review flags.'))
    })
  } finally {
    db.close()
  }
}

/** Removes the v1 store reference without deleting its rows (kept for data safety). */
export function legacyStoreNameForDiagnostics() { return legacyStoreName }
