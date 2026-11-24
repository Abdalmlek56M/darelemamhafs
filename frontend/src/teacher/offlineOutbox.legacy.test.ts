import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { claimLegacyAttendance, listLegacyAttendance, listQueuedAttendance } from './offlineOutbox'

const DB = 'dar-teacher-outbox'
const V1_STORE = 'attendance'

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
    request.onupgradeneeded = () => { request.result.createObjectStore(V1_STORE, { keyPath: 'sessionId' }) }
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

beforeEach(async () => { await deleteDb() })

describe('P0-6 legacy claim', () => {
  it('never assigns or sends legacy rows before an explicit claim', async () => {
    await seedV1([{ sessionId: 'legacy-1', marks: [{ enrollmentId: 'en-1', status: 'present' }], queuedAt: '2026-01-01T00:00:00.000Z' }])
    const legacy = await listLegacyAttendance()
    expect(legacy).toHaveLength(1)
    expect(legacy[0].userId).toBe('__legacy__')
    expect(await listQueuedAttendance('user-a')).toHaveLength(0)
  })

  it('claims legacy rows only for the explicit teacher and moves them into that user queue', async () => {
    await seedV1([
      { sessionId: 'legacy-1', marks: [{ enrollmentId: 'en-1', status: 'present' }], queuedAt: '2026-01-01T00:00:00.000Z' },
      { sessionId: 'legacy-2', marks: [{ enrollmentId: 'en-2', status: 'absent' }], queuedAt: '2026-01-02T00:00:00.000Z' },
    ])
    expect(await claimLegacyAttendance('user-a')).toBe(2)
    expect(await listLegacyAttendance()).toHaveLength(0)
    const queue = await listQueuedAttendance('user-a')
    expect(queue).toHaveLength(2)
    expect(queue.every(row => row.userId === 'user-a' && row.needsReview === false)).toBe(true)
    expect(await listQueuedAttendance('user-b')).toHaveLength(0)
    expect(await claimLegacyAttendance('user-b')).toBe(0)
  })
})
