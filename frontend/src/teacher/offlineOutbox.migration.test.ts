import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { listQueuedAttendance } from './offlineOutbox'

const DB = 'dar-teacher-outbox'
const V1_STORE = 'attendance'
const QUEUE_STORE = 'attendance-queue'

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => resolve()
  })
}

function seedV1(rows: Array<{ sessionId: string; marks: Array<{ enrollmentId: string; status: 'present' | 'excused' | 'absent' }>; queuedAt: string }>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(V1_STORE, { keyPath: 'sessionId' })
    }
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(V1_STORE, 'readwrite')
      for (const row of rows) tx.objectStore(V1_STORE).put(row)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    }
    request.onerror = () => reject(request.error)
  })
}

function readStore<T>(storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(storeName, 'readonly')
      const getAll = tx.objectStore(storeName).getAll()
      getAll.onsuccess = () => { db.close(); resolve(getAll.result as T[]) }
      getAll.onerror = () => { db.close(); reject(getAll.error) }
    }
    request.onerror = () => reject(request.error)
  })
}

beforeEach(async () => { await deleteDb() })

describe('P0-6 outbox v1 → v3 migration', () => {
  it('copies v1 queued attendance into the queue as unassigned legacy rows and keeps v1 intact', async () => {
    await seedV1([
      { sessionId: 'legacy-session-1', marks: [{ enrollmentId: 'en-1', status: 'present' }], queuedAt: '2026-01-01T00:00:00.000Z' },
      { sessionId: 'legacy-session-2', marks: [{ enrollmentId: 'en-2', status: 'absent' }], queuedAt: '2026-01-02T00:00:00.000Z' },
    ])

    // Opening the app's DB triggers the version upgrade + migration. Before P0-6 this is v2 and nothing is copied.
    await listQueuedAttendance('user-a')

    const queue = await readStore<{ id: string; userId: string; sessionId: string; needsReview: boolean }>(QUEUE_STORE)
    expect(queue).toHaveLength(2)
    expect(queue.every(row => row.userId === '__legacy__')).toBe(true)
    expect(queue.every(row => row.needsReview === true)).toBe(true)
    expect(queue.map(row => row.sessionId).sort()).toEqual(['legacy-session-1', 'legacy-session-2'])

    const v1 = await readStore<{ sessionId: string }>(V1_STORE)
    expect(v1.map(row => row.sessionId).sort()).toEqual(['legacy-session-1', 'legacy-session-2'])
    expect(await listQueuedAttendance('user-a')).toHaveLength(0)
  })
})
