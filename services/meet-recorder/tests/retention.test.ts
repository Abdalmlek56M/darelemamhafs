import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanHlsRetention, cleanRuntimeDirs } from '../src/storage/retention.js'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dar-meet-retention-'))
  roots.push(root)
  return root
}

describe('recorder retention (FINAL 1.20/1.24)', () => {
  it('removes only stale runtime job dirs', async () => {
    const root = await tempRoot()
    const runtime = join(root, '.runtime')
    const stale = join(runtime, 'job-old')
    const fresh = join(runtime, 'job-new')
    await mkdir(stale, { recursive: true })
    await mkdir(fresh, { recursive: true })
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
    await writeFile(join(stale, 'pulse.pid'), '1')
    const { utimesSync } = await import('node:fs')
    utimesSync(stale, old, old)

    const removed = await cleanRuntimeDirs(root, Date.now(), 24 * 60 * 60 * 1000)
    expect(removed).toBe(1)
    await expect(stat(stale)).rejects.toBeTruthy()
    expect((await stat(fresh)).isDirectory()).toBe(true)
  })

  it('deletes old HLS folders but keeps MP4 archives', async () => {
    const root = await tempRoot()
    const oldJob = join(root, 'jobs', 'old')
    const newJob = join(root, 'jobs', 'new')
    await mkdir(join(oldJob, 'hls'), { recursive: true })
    await mkdir(join(newJob, 'hls'), { recursive: true })
    await writeFile(join(oldJob, 'recording.mp4'), 'mp4')
    await writeFile(join(newJob, 'recording.mp4'), 'mp4')
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    const { utimesSync } = await import('node:fs')
    utimesSync(join(oldJob, 'hls'), old, old)

    const removed = await cleanHlsRetention(root, Date.now(), 30)
    expect(removed).toBe(1)
    await expect(stat(join(oldJob, 'hls'))).rejects.toBeTruthy()
    expect((await stat(join(oldJob, 'recording.mp4'))).isFile()).toBe(true)
    expect((await stat(join(newJob, 'hls'))).isDirectory()).toBe(true)
  })
})
