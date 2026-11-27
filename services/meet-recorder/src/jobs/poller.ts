import { join } from 'node:path'
import { DarClient } from '../api/darClient.js'
import { StatusOutbox } from '../api/outbox.js'
import type { BotConfig } from '../config.js'
import type { Logger } from '../logger.js'
import { cleanHlsRetention, cleanRuntimeDirs } from '../storage/retention.js'
import { runRecordingJob } from './recording.js'

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

/** One poll iteration, exported so the loop is unit-testable without timers or network. */
export async function pollOnce(
  client: DarClient,
  outbox: StatusOutbox,
  config: BotConfig,
  logger: Logger,
  runJob: typeof runRecordingJob = runRecordingJob
): Promise<'idle' | 'ran'> {
  await outbox.flush(async (report) => {
    await client.reportStatus(report.jobId, report.status, report.errorCode ?? undefined, report.errorMessage ?? undefined, report.extras)
  }, config.outboxMaxAttempts).catch((error: unknown) => {
    logger.warn('outbox flush failed', { error: String(error) })
  })

  const job = await client.claim()
  if (!job) return 'idle'

  logger.info('job claimed', {
    jobId: job.id,
    meetLink: job.meetLink,
    startsAt: job.scheduledStart,
    endsAt: job.scheduledEnd
  })
  await runJob(job, config, logger, client, outbox)
  return 'ran'
}

/**
 * Poll loop. Before the first claim it recovers stale runtime dirs left by a dead process
 * (FINAL 1.24) and purges HLS output past the retention window (FINAL 1.20).
 */
export async function runPoller(config: BotConfig, logger: Logger, signal: AbortSignal): Promise<void> {
  const client = new DarClient(config.apiBaseUrl, config.serviceToken, logger)
  const outbox = new StatusOutbox(join(config.mediaRoot, '.runtime', 'outbox'))

  const runtimeRemoved = await cleanRuntimeDirs(config.mediaRoot, Date.now(), config.runtimeRetentionHours * 60 * 60 * 1000)
  const hlsRemoved = await cleanHlsRetention(config.mediaRoot, Date.now(), config.hlsRetentionDays)
  if (runtimeRemoved > 0 || hlsRemoved > 0) {
    logger.info('startup retention cleanup', { runtimeDirs: runtimeRemoved, hlsDirs: hlsRemoved })
  }

  const health = await client.health()
  logger.info('poller online', { api: config.apiBaseUrl, health: health?.status ?? 'ok', worker: config.workerName })

  while (!signal.aborted) {
    try {
      if ((await pollOnce(client, outbox, config, logger)) === 'idle') {
        await sleep(config.pollIntervalMs, signal)
      }
    } catch (error) {
      logger.error('poller iteration failed', { error: String(error) })
      await sleep(Math.max(config.pollIntervalMs, 10_000), signal)
    }
  }

  logger.info('poller stopped')
}
