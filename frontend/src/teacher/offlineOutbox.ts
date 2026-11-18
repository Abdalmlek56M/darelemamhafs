/** Offline outbox for teacher attendance only. Never stores money or roster names. */
export type QueuedAttendanceMark = { enrollmentId: string; status: 'present' | 'excused' | 'absent' }
export type QueuedAttendance = { sessionId: string; marks: QueuedAttendanceMark[]; queuedAt: string }

const dbName = 'dar-teacher-outbox'
const storeName = 'attendance'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available.')); return }
    const request = indexedDB.open(dbName, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'sessionId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the offline store.'))
  })
}

export async function queueAttendance(sessionId: string, marks: QueuedAttendanceMark[]) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put({ sessionId, marks, queuedAt: new Date().toISOString() } satisfies QueuedAttendance)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Could not save the offline attendance.'))
  })
  db.close()
}

export async function listQueuedAttendance(): Promise<QueuedAttendance[]> {
  const db = await openDb()
  const items = await new Promise<QueuedAttendance[]>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const request = tx.objectStore(storeName).getAll()
    request.onsuccess = () => resolve((request.result ?? []) as QueuedAttendance[])
    request.onerror = () => reject(request.error ?? new Error('Could not read the offline attendance.'))
  })
  db.close()
  return items
}

export async function removeQueuedAttendance(sessionId: string) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).delete(sessionId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Could not clear the offline attendance.'))
  })
  db.close()
}
