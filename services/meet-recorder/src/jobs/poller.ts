import { DarClient } from '../api/darClient.js'
import type { BotConfig } from '../config.js'
import type { Logger } from '../logger.js'
import { runRecordingJob } from './recording.js'

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

/**
 * Poll loop for phase 3.2. It proves the queue contract (claim + heartbeat + status) and
 * leaves the recording itself to 3.3, where a claimed job drives Playwright + capture.
 */
export async function runPoller(config: BotConfig, logger: Logger, signal: AbortSignal): Promise<void> {
  const client = new DarClient(config.apiBaseUrl, config.serviceToken, logger)
  const health = await client.health()
  logger.info('poller online', { api: config.apiBaseUrl, health: health?.status ?? 'ok', worker: config.workerName })

  while (!signal.aborted) {
    try {
      const job = await client.claim()
      if (!job) {
        await sleep(config.pollIntervalMs, signal)
        continue
      }

      logger.info('job claimed', {
        jobId: job.id,
        meetLink: job.meetLink,
        startsAt: job.scheduledStart,
        endsAt: job.scheduledEnd
      })
      await runRecordingJob(job, config, logger, client)
    } catch (error) {
      logger.error('poller iteration failed', { error: String(error) })
      await sleep(Math.max(config.pollIntervalMs, 10_000), signal)
    }
  }

  logger.info('poller stopped')
}
