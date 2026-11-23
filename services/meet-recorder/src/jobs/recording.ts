import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { BotJob, DarClient } from '../api/darClient.js'
import type { BotConfig } from '../config.js'
import type { Logger } from '../logger.js'
import { NullAudioSink } from '../media/audio.js'
import { ScreenCapture } from '../media/capture.js'
import { VirtualDisplay } from '../media/display.js'
import { launchBrowser, type LaunchedBrowser } from '../meet/browser.js'
import { joinMeet, leaveCall } from '../meet/join.js'
import { admitWaiting, openMeetingAccess } from '../meet/access.js'
import { assertFreeSpace } from '../storage/disk.js'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const MAX_SESSION_MS = 4 * 60 * 60 * 1000

/**
 * One recording job: reveal the profile, join the Meet, capture the display and the
 * meeting audio, stop at the scheduled end plus the grace period, then report the files.
 * Every exit path (success, join failure, crash) reports a terminal status to Dar.Api so a
 * job can never stay silently stuck in `joining`.
 */
export async function runRecordingJob(
  job: BotJob,
  config: BotConfig,
  logger: Logger,
  client: DarClient
): Promise<void> {
  const sessionDir = join(config.mediaRoot, 'jobs', job.id)
  const runtimeDir = join(config.mediaRoot, '.runtime', `job-${job.id}`)
  await mkdir(sessionDir, { recursive: true })

  const display = new VirtualDisplay(config.displayNumber, config.width, config.height, logger)
  const audio = new NullAudioSink('darmeet_job', runtimeDir, logger)
  let browser: LaunchedBrowser | null = null
  let capture: ScreenCapture | null = null
  let heartbeat: NodeJS.Timeout | null = null

  try {
    await assertFreeSpace(config.mediaRoot, config.diskBlockGb)
    await display.start()
    await audio.start()

    browser = await launchBrowser(config.profileDir, display.name, logger)
    if (!job.meetLink) {
      await client.reportStatus(job.id, 'failed', 'missing_meet_link', 'الحدث بلا رابط Google Meet.')
      return
    }

    const outcome = await joinMeet(browser.page, job.meetLink, join(sessionDir, 'join.png'), logger)
    if (outcome.state !== 'joined') {
      await client.reportStatus(job.id, 'failed', `join_${outcome.state}`, outcome.detail)
      return
    }

    await client.reportStatus(job.id, 'live')
    // Participants must not wait for a human: open the meeting and admit anyone who knocks.
    await openMeetingAccess(browser.page, logger).catch(() => undefined)
    heartbeat = setInterval(() => {
      void client.heartbeat(job.id).catch((error: unknown) => {
        logger.warn('heartbeat failed', { jobId: job.id, error: String(error) })
      })
    }, config.heartbeatMs)

    capture = new ScreenCapture(config, sessionDir, logger)
    await capture.start(display.name, audio.monitorSource, { ...audio.env, DISPLAY: display.name })

    const scheduledEnd = new Date(job.scheduledEnd).getTime()
    const stopAt = Math.min(scheduledEnd + job.stopGraceSeconds * 1000, Date.now() + MAX_SESSION_MS)
    logger.info('recording until the scheduled end', {
      jobId: job.id,
      scheduledEnd: job.scheduledEnd,
      stopAt: new Date(stopAt).toISOString()
    })
    while (Date.now() < stopAt) {
      await sleep(4000)
      await admitWaiting(browser.page, logger).catch(() => 0)
    }

    // The state machine requires live -> finalizing -> ready; reporting ready directly is
    // rejected with 409 (invalid_transition:live->ready).
    await client.reportStatus(job.id, 'finalizing')
    const result = await capture.stop()
    capture = null
    const duration = Math.round(result.durationSeconds)
    await client.reportStatus(job.id, 'ready', undefined, undefined, {
      durationSeconds: duration,
      artifacts: [
        {
          kind: 'mp4',
          localPath: result.mp4Path,
          sizeBytes: result.sizeBytes,
          sha256: result.sha256,
          durationSeconds: duration
        },
        ...(result.posterPath
          ? [{ kind: 'poster', localPath: result.posterPath, sizeBytes: 0, sha256: null as string | null, durationSeconds: 0 }]
          : []),
        { kind: 'hls', localPath: result.hlsDir, sizeBytes: 0, sha256: null as string | null, durationSeconds: 0 }
      ]
    })
    logger.info('recording finished', { jobId: job.id, duration, sizeBytes: result.sizeBytes })
  } catch (error) {
    logger.error('recording failed', { jobId: job.id, error: String(error) })
    await client
      .reportStatus(job.id, 'failed', 'recording_failed', String(error).slice(0, 500))
      .catch(() => undefined)
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    await capture?.stop().catch(() => undefined)
    // Leave cleanly so the account is not "already in the call" for the next job.
    if (browser) await leaveCall(browser.page, logger).catch(() => undefined)
    await browser?.context.close().catch(() => undefined)
    await audio.stop().catch(() => undefined)
    await display.stop().catch(() => undefined)
  }
}
