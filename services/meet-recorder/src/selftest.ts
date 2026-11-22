import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { BotConfig } from './config.js'
import type { Logger } from './logger.js'
import { NullAudioSink } from './media/audio.js'
import { ScreenCapture } from './media/capture.js'
import { VirtualDisplay } from './media/display.js'
import { ManagedProcess } from './media/process.js'
import { assertFreeSpace } from './storage/disk.js'

export type SelfTestSummary = {
  ok: boolean
  sessionDir: string
  mp4Path: string | null
  hlsSegments: number
  durationSeconds: number
  sizeBytes: number
  sha256: string | null
  freeGigabytes: number
  failures: string[]
  elapsedSeconds: number
}

/**
 * Phase 3.2 acceptance: prove the capture pipeline works end to end without Google Meet.
 * Xvfb shows a banner, PulseAudio plays silence into a null sink and FFmpeg records both
 * into an MP4 + HLS playlist. The result must be a playable file with a sane duration.
 */
export async function runSelfTest(config: BotConfig, logger: Logger): Promise<SelfTestSummary> {
  const startedAt = Date.now()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const sessionDir = join(config.mediaRoot, `selftest-${stamp}`)
  const runtimeDir = join(config.mediaRoot, '.runtime', `selftest-${process.pid}`)
  await mkdir(sessionDir, { recursive: true })

  const failures: string[] = []
  const display = new VirtualDisplay(config.displayNumber, config.width, config.height, logger)
  const audio = new NullAudioSink('darmeet_selftest', runtimeDir, logger)
  let banner: ManagedProcess | null = null
  let capture: ScreenCapture | null = null
  let freeGigabytes = 0

  try {
    freeGigabytes = await assertFreeSpace(config.mediaRoot, config.diskBlockGb)

    await display.start()
    await audio.start()
    banner = new ManagedProcess('xmessage', {
      command: 'xmessage',
      args: [
        '-geometry', `${config.width}x${config.height}+0+0`,
        '-center',
        `DAR MEET SELF TEST
${new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo' })}

recording ${config.selftestSeconds}s at ${config.width}x${config.height}`
      ],
      env: display.env
    })
    banner.start()

    capture = new ScreenCapture(config, sessionDir, logger, config.selftestSeconds)
    // FFmpeg must see the same display and the same private PulseAudio server as the
    // sink; a mismatched XDG_RUNTIME_DIR makes libpulse fail with ESRCH.
    const captureEnv: NodeJS.ProcessEnv = { ...audio.env, DISPLAY: display.name }
    await capture.start(display.name, audio.monitorSource, captureEnv)
    await capture.waitForExit((config.selftestSeconds + 20) * 1000)
    const result = await capture.stop()
    capture = null

    if (result.durationSeconds < config.selftestSeconds - 2) {
      failures.push(`duration ${result.durationSeconds}s is shorter than ${config.selftestSeconds}s`)
    }
    if (result.sizeBytes < 50_000) failures.push(`mp4 size ${result.sizeBytes} bytes is suspiciously small`)
    if (result.segments < 1) failures.push('no HLS segments were produced')
    if (!result.posterPath) failures.push('poster frame was not generated')

    const poster = result.posterPath ? await stat(result.posterPath).catch(() => null) : null
    if (result.posterPath && (!poster || poster.size === 0)) failures.push('poster frame is empty')

    return {
      ok: failures.length === 0,
      sessionDir,
      mp4Path: result.mp4Path,
      hlsSegments: result.segments,
      durationSeconds: result.durationSeconds,
      sizeBytes: result.sizeBytes,
      sha256: result.sha256,
      freeGigabytes,
      failures,
      elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
    return {
      ok: false,
      sessionDir,
      mp4Path: null,
      hlsSegments: 0,
      durationSeconds: 0,
      sizeBytes: 0,
      sha256: null,
      freeGigabytes,
      failures,
      elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10
    }
  } finally {
    await capture?.stop().catch(() => undefined)
    await banner?.stop().catch(() => undefined)
    await audio.stop().catch(() => undefined)
    await display.stop().catch(() => undefined)
  }
}
