import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BotStatusExtras } from './darClient.js'

/**
 * FINAL 1.19: terminal status reports are the only proof a job finished. If Dar.Api is
 * briefly unreachable they are persisted locally and retried with backoff on the next poll.
 */
export type OutboxReport = {
  jobId: string
  status: string
  errorCode: string | null
  errorMessage: string | null
  extras: BotStatusExtras
  enqueuedAt: string
}

type Sender = (report: OutboxReport) => Promise<void>

export class StatusOutbox {
  constructor(
    private readonly dir: string,
    private readonly sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  ) {}

  async enqueue(report: Omit<OutboxReport, 'enqueuedAt'>): Promise<string> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const name = `${Date.now()}-${report.jobId}-${report.status}.json`
    const path = join(this.dir, name)
    const payload: OutboxReport = { ...report, enqueuedAt: new Date().toISOString() }
    await writeFile(path, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
    return path
  }

  async pending(): Promise<string[]> {
    const names = await readdir(this.dir).catch(() => [] as string[])
    return names.filter((name) => name.endsWith('.json')).sort()
  }

  async flush(send: Sender, maxAttempts = 5, baseDelayMs = 500): Promise<number> {
    let sent = 0
    for (const name of await this.pending()) {
      const path = join(this.dir, name)
      let lastError: unknown = null
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const report = JSON.parse(await readFile(path, 'utf8')) as OutboxReport
          await send(report)
          await rm(path, { force: true })
          sent += 1
          lastError = null
          break
        } catch (error) {
          lastError = error
          if (attempt + 1 < maxAttempts) await this.sleepFn(baseDelayMs * 2 ** attempt)
        }
      }
      if (lastError !== null) break // keep the file for the next poll cycle
    }
    return sent
  }
}
