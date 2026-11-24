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

const dbName = 'dar-teacher-outbox'
const storeName = 'attendance-queue'
const legacyStoreName = 'attendance'
const dbVersion = 2

/** Stable queue key: attendance is per user and per teacher session. */
export function queueId(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`
}

/** A queued mark belongs to exactly one account, even on a shared device. */
export function isQueuedForUser(item: Pick<QueuedAttendance, 'userId'>, userId: string): boolean {
  return item.userId === userId
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available.')); return }
    const request = indexedDB.open(dbName, dbVersion)
    request.onupgradeneeded = () => {
      const db = request.result
      // The v1 attendance store is left untouched (never delete queued attendance on upgrade).
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'id' })
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
