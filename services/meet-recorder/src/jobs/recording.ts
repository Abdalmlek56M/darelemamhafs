import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { BotJob, DarClient } from '../api/darClient.js'
import { StatusOutbox, type OutboxReport } from '../api/outbox.js'
import type { BotConfig } from '../config.js'
import type { Logger } from '../logger.js'
import { NullAudioSink } from '../media/audio.js'
import { ScreenCapture } from '../media/capture.js'
import { VirtualDisplay } from '../media/display.js'
import { launchBrowser, type LaunchedBrowser } from '../meet/browser.js'
import { joinMeet, leaveCall } from '../meet/join.js'
import { admitWaiting, countParticipants, openMeetingAccess } from '../meet/access.js'
import { collectWebRtcAudio } from '../meet/webrtc.js'
import { isStopping } from '../lifecycle.js'
import { assertFreeSpace, freeGigabytes, shouldStopForDisk } from '../storage/disk.js'
import { validateMeetLink } from '../meet/link.js'
import { nextIdleState, type IdleState } from './idle.js'
import { JobStatusTracker } from './statusTracker.js'
import type { BotStatusExtras } from '../api/darClient.js'
import type { JobStatus } from './stateMachine.js'
import { sleep } from '../lib/sleep.js'

const MAX_SESSION_MS = 4 * 60 * 60 * 1000
const TICK_MS = 5000

/**
 * One recording job: validate the link, reveal the profile, join the Meet, capture the
 * display and the meeting audio, stop at the scheduled end plus the grace period, then
 * report the files. Every exit path reports a terminal status; a failed terminal report is
 * persisted in the local outbox and retried by the poller (FINAL 1.19).
 */
export async function runRecordingJob(
  job: BotJob,
  config: BotConfig,
  logger: Logger,
  client: DarClient,
  outbox: StatusOutbox = new StatusOutbox(join(config.mediaRoot, '.runtime', 'outbox'))
): Promise<void> {
  const sessionDir = join(config.mediaRoot, 'jobs', job.id)
  const runtimeDir = join(config.mediaRoot, '.runtime', `job-${job.id}`)
  await mkdir(sessionDir, { recursive: true })

  const display = new VirtualDisplay(config.displayNumber, config.width, config.height, logger)
  const audio = new NullAudioSink('darmeet_job', runtimeDir, logger)
  let browser: LaunchedBrowser | null = null
  let capture: ScreenCapture | null = null
  const tracker = new JobStatusTracker((job.status as JobStatus) ?? 'joining')

  const report = async (
    status: JobStatus,
    errorCode?: string,
    errorMessage?: string,
    extras?: BotStatusExtras
  ): Promise<boolean> => {
    if (!tracker.tryAdvance(status)) {
      logger.warn('refusing an invalid job transition', { jobId: job.id, from: tracker.status, to: status })
      return false
    }
    const report: Omit<OutboxReport, 'enqueuedAt'> = {
      jobId: job.id,
      status,
      errorCode: errorCode ?? null,
      errorMessage: errorMessage ?? null,
      extras: extras ?? {}
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await client.reportStatus(job.id, status, errorCode, errorMessage, extras)
        return true
      } catch (error) {
        if (attempt === 2) {
          const terminal = status === 'ready' || status === 'failed' || status === 'partial'
          if (terminal) {
            await outbox.enqueue(report).catch((enqueueError: unknown) => {
              logger.error('could not persist the terminal status in the outbox', { error: String(enqueueError) })
            })
            logger.warn('terminal status kept in the outbox for retry', { jobId: job.id, status })
          } else {
            logger.warn('status report failed', { jobId: job.id, status, error: String(error) })
          }
          return false
        }
        await sleep(500 * 2 ** attempt)
      }
    }
    return false
  }

  try {
    // FINAL 1.18: validate the link before starting Xvfb/Chromium and only allow Meet hosts.
    const link = validateMeetLink(job.meetLink)
    if (!link.ok) {
      const code = link.reason === 'missing' ? 'missing_meet_link' : `invalid_meet_link_${link.reason}`
      await report('failed', code, 'رابط Google Meet غير صالح.')
      return
    }

    await assertFreeSpace(config.mediaRoot, config.diskBlockGb)
    await display.start()
    await audio.start()

    const chromeEnv: NodeJS.ProcessEnv =
      config.chromePulseLatencyMs > 0
        ? { ...audio.env, PULSE_LATENCY_MSEC: String(config.chromePulseLatencyMs) }
        : audio.env
    const chromeArgs = config.chromeAudioBuffer > 0 ? [`--audio-buffer-size=${config.chromeAudioBuffer}`] : []
    browser = await launchBrowser(config.profileDir, display.name, logger, chromeEnv, chromeArgs)

    const outcome = await joinMeet(browser.page, link.url, join(sessionDir, 'join.png'), logger)
    if (outcome.state !== 'joined') {
      await report('failed', `join_${outcome.state}`, outcome.detail)
      return
    }

    await report('live')
    if ((job.accessType ?? 'open') === 'open' && config.autoAdmit) {
      await openMeetingAccess(browser.page, logger).catch(() => undefined)
    } else {
      logger.info('meeting access left as trusted/by configuration', { jobId: job.id, autoAdmit: config.autoAdmit })
    }

    capture = new ScreenCapture(config, sessionDir, logger)
    await capture.start(display.name, audio.monitorSource, { ...audio.env, DISPLAY: display.name })

    for (const waitMs of [5000, 5000, 10000]) {
      await sleep(waitMs)
      const inputs = await audio.sinkInputs()
      logger.info('audio check', { sinkInputs: inputs })
      if (inputs > 0) break
    }
    if ((await audio.sinkInputs()) === 0) {
      logger.warn('no audio client on the null sink: the recording may be silent')
    }

    const scheduledEnd = new Date(job.scheduledEnd).getTime()
    const maxSessionMs = (job.maxSessionMinutes ?? 240) * 60_000
    const idleStopMs = (job.idleStopSeconds ?? 300) * 1000
    const stopAt = Math.min(scheduledEnd + job.stopGraceSeconds * 1000, Date.now() + maxSessionMs, Date.now() + MAX_SESSION_MS)
    logger.info('recording until the scheduled end', {
      jobId: job.id,
      scheduledEnd: job.scheduledEnd,
      accessType: job.accessType ?? 'open',
      idleStopSeconds: job.idleStopSeconds ?? 300,
      idleConfirmTicks: config.idleConfirmTicks,
      captureMode: config.captureMode,
      stopAt: new Date(stopAt).toISOString()
    })

    let paused = false
    let audioOk: boolean | null = null
    let ticks = 0
    let idle: IdleState = { emptySince: null, lowStreak: 0 }
    let lowDisk = false
    while (Date.now() < stopAt) {
      await sleep(TICK_MS)
      ticks += 1
      if (ticks % 3 === 0) audioOk = (await audio.sinkInputs()) > 0

      // FINAL 1.20: keep checking disk during the lesson, not only before it starts.
      if (ticks % 6 === 0) {
        const free = await freeGigabytes(config.mediaRoot).catch(() => Number.POSITIVE_INFINITY)
        if (shouldStopForDisk(free, config.diskStopGb)) {
          logger.warn('stopping: free disk fell below the active-recording threshold', { freeGb: free, thresholdGb: config.diskStopGb })
          lowDisk = true
          break
        }
      }

      const participants = await countParticipants(browser.page).catch(() => null)
      const commands = await client.heartbeat(job.id, participants, audioOk).catch((error: unknown) => {
        logger.warn('heartbeat failed', { jobId: job.id, error: String(error) })
        return null
      })
      if (config.autoAdmit) await admitWaiting(browser.page, logger).catch(() => 0)

      const webrtcAudio = await collectWebRtcAudio(browser.page).catch(() => ({ peers: 0, hooked: false, types: [], stats: [] }))
      logger.info('webrtc audio', {
        jobId: job.id,
        peers: webrtcAudio.peers,
        hooked: webrtcAudio.hooked,
        ...(webrtcAudio.stats.length === 0 ? { types: webrtcAudio.types } : {}),
        stats: webrtcAudio.stats
      })

      if (commands?.stop) {
        logger.info('stop requested from the admin panel', { jobId: job.id })
        break
      }
      if (isStopping()) {
        logger.info('service is stopping: finalising the recording', { jobId: job.id })
        break
      }
      if (commands && commands.pause !== paused) {
        paused = commands.pause
        if (paused) capture.pause()
        else capture.resume()
      }

      if (idleStopMs > 0) {
        const decision = nextIdleState(idle, participants, Date.now(), idleStopMs, config.idleConfirmTicks)
        idle = decision.state
        if (decision.stop) {
          logger.info(decision.reason ?? 'stopping: the room stayed empty', { jobId: job.id, participants })
          break
        }
      }
    }

    const terminal: JobStatus = lowDisk ? 'partial' : 'ready'
    await report('finalizing')
    const result = await capture.stop()
    capture = null
    const duration = Math.round(result.durationSeconds)
    await report(terminal, lowDisk ? 'disk_low' : undefined, lowDisk ? 'تم إيقاف التسجيل بسبب انخفاض مساحة القرص.' : undefined, {
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
        ...(result.hlsDir && result.segments > 0
          ? [{ kind: 'hls', localPath: result.hlsDir, sizeBytes: 0, sha256: null as string | null, durationSeconds: 0 }]
          : [])
      ]
    })
    logger.info('recording finished', { jobId: job.id, duration, sizeBytes: result.sizeBytes, lowDisk })
  } catch (error) {
    logger.error('recording failed', { jobId: job.id, error: String(error) })
    await report('failed', 'recording_failed', String(error).slice(0, 500))
  } finally {
    await capture?.stop().catch(() => undefined)
    if (browser) await leaveCall(browser.page, logger).catch(() => undefined)
    await browser?.context.close().catch(() => undefined)
    await audio.stop().catch(() => undefined)
    await display.stop().catch(() => undefined)
  }
}
