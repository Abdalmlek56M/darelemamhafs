import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StatusOutbox } from '../src/api/outbox.js'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('terminal status outbox (FINAL 1.19)', () => {
  it('persists failed terminal reports and flushes them with retries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dar-outbox-'))
    roots.push(root)
    const outbox = new StatusOutbox(root, async () => undefined)
    await outbox.enqueue({ jobId: 'job-1', status: 'ready', errorCode: null, errorMessage: null, extras: { durationSeconds: 10 } })
    await outbox.enqueue({ jobId: 'job-2', status: 'failed', errorCode: 'join_failed', errorMessage: 'x', extras: {} })
    expect(await outbox.pending()).toHaveLength(2)

    const sent: string[] = []
    let failures = 2
    const count = await outbox.flush(async (report) => {
      if (failures > 0) {
        failures -= 1
        throw new Error('api down')
      }
      sent.push(report.jobId)
    }, 5, 0)
    expect(count).toBe(2)
    expect(sent).toEqual(['job-1', 'job-2'])
    expect(await outbox.pending()).toHaveLength(0)
  })

  it('keeps a file when every attempt fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dar-outbox-'))
    roots.push(root)
    const outbox = new StatusOutbox(root, async () => undefined)
    await outbox.enqueue({ jobId: 'job-3', status: 'failed', errorCode: 'x', errorMessage: 'y', extras: {} })
    const count = await outbox.flush(async () => { throw new Error('down') }, 2, 0)
    expect(count).toBe(0)
    expect(await outbox.pending()).toHaveLength(1)
  })
})
