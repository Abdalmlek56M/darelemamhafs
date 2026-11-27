import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** FINAL 1.20/1.24: bounded on-disk retention for runtime scratch and HLS output. */

/** Remove stale `.runtime/job-*` directories left by a crashed/dead job process. */
export async function cleanRuntimeDirs(mediaRoot: string, nowMs: number, retentionMs: number): Promise<number> {
  const runtimeRoot = join(mediaRoot, '.runtime')
  const entries = await readdir(runtimeRoot, { withFileTypes: true }).catch(() => [])
  let removed = 0
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('job-')) continue
    const path = join(runtimeRoot, entry.name)
    const info = await stat(path).catch(() => null)
    if (!info || nowMs - info.mtimeMs <= retentionMs) continue
    await rm(path, { recursive: true, force: true })
    removed += 1
  }
  return removed
}

/** Delete HLS folders older than the retention policy; the MP4 archive is never touched. */
export async function cleanHlsRetention(mediaRoot: string, nowMs: number, retentionDays: number): Promise<number> {
  const jobsRoot = join(mediaRoot, 'jobs')
  const entries = await readdir(jobsRoot, { withFileTypes: true }).catch(() => [])
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000
  let removed = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const hlsDir = join(jobsRoot, entry.name, 'hls')
    const info = await stat(hlsDir).catch(() => null)
    if (!info || nowMs - info.mtimeMs <= maxAgeMs) continue
    await rm(hlsDir, { recursive: true, force: true })
    removed += 1
  }
  return removed
}

export async function ensureRuntimeDir(mediaRoot: string, jobId: string): Promise<string> {
  const path = join(mediaRoot, '.runtime', `job-${jobId}`)
  await mkdir(path, { recursive: true, mode: 0o700 })
  return path
}
