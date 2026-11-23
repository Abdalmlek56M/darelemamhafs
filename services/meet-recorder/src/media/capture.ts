import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { BotConfig } from '../config.js'
import type { Logger } from '../logger.js'
import { ManagedProcess } from './process.js'

const run = promisify(execFile)

export type CaptureResult = {
  mp4Path: string
  hlsDir: string
  posterPath: string | null
  durationSeconds: number
  sizeBytes: number
  sha256: string
  segments: number
}

/**
 * Records the virtual display + the PulseAudio monitor into one MP4 (archive) and an HLS
 * playlist (live view). FFmpeg is stopped with SIGINT so both outputs are finalised.
 * Files live under `<mediaRoot>/<sessionKey>/` and never leave the host in this phase.
 */
export class ScreenCapture {
  private process: ManagedProcess | null = null
  private readonly startedAt = Date.now()

  constructor(
    private readonly config: BotConfig,
    private readonly sessionDir: string,
    private readonly logger: Logger,
    private readonly durationSeconds?: number
  ) {}

  get rawPath(): string {
    return join(this.sessionDir, 'recording.raw.mp4')
  }

  get mp4Path(): string {
    return join(this.sessionDir, 'recording.mp4')
  }

  get hlsDir(): string {
    return join(this.sessionDir, 'hls')
  }

  async start(display: string, audioSource: string, env: NodeJS.ProcessEnv): Promise<void> {
    await mkdir(this.hlsDir, { recursive: true })
    const args = this.buildArguments(display, audioSource)
    this.process = new ManagedProcess('ffmpeg', {
      command: 'ffmpeg',
      args,
      env,
      onLine: (line, stream) => {
        if (/error|invalid|failed/i.test(line)) this.logger.warn('ffmpeg', { stream, line })
        else this.logger.debug('ffmpeg', { stream, line })
      }
    })
    this.process.start()
    // Give FFmpeg a moment to open the devices; a hard failure shows up here.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    if (!this.process.running) {
      throw new Error(`ffmpeg exited immediately: ${this.process.lastLines.join(' | ')}`)
    }
    this.logger.info('capture started', { display, audioSource, sessionDir: this.sessionDir })
  }

  async stop(): Promise<CaptureResult> {
    if (this.process) {
      const code = await this.process.stop(20_000)
      this.logger.info('ffmpeg stopped', { exitCode: code })
      this.process = null
    }
    return await this.finalize()
  }

  /** Freezes the encoder (SIGSTOP): the recording keeps a single timeline. */
  pause(): boolean {
    const ok = this.process?.signal('SIGSTOP') ?? false
    if (ok) this.logger.info('capture paused')
    return ok
  }

  /** Resumes a paused encoder. */
  resume(): boolean {
    const ok = this.process?.signal('SIGCONT') ?? false
    if (ok) this.logger.info('capture resumed')
    return ok
  }

  get running(): boolean {
    return this.process?.running ?? false
  }

  /** Waits for FFmpeg to finish on its own (used when a fixed duration was requested). */
  async waitForExit(timeoutMs: number): Promise<number | null> {
    return this.process ? this.process.wait(timeoutMs) : null
  }

  private buildArguments(display: string, audioSource: string): string[] {
    const { width, height, framerate, videoBitrate, audioBitrate } = this.config
    const args = [
      '-hide_banner', '-nostdin', '-loglevel', 'warning', '-y',
      '-thread_queue_size', '512',
      '-f', 'x11grab', '-draw_mouse', '0',
      '-framerate', String(framerate),
      '-video_size', `${width}x${height}`,
      '-i', display,
      '-thread_queue_size', '1024',
      // Keep PulseAudio's own (sample-count) timestamps: they are smooth, while wall-clock
      // timestamps exposed every burst as a 60-300ms hole. aresample=async compensates the
      // sink's small clock drift by inserting/removing samples instead of leaving gaps.
      '-f', 'pulse', '-fragment_size', '8192', '-i', audioSource,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-preset', this.config.videoPreset, '-tune', 'zerolatency',
      '-threads', String(this.config.videoThreads),
      '-pix_fmt', 'yuv420p', '-b:v', videoBitrate, '-g', String(framerate * 2),
      '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '48000', '-ac', '2',
      '-af', 'aresample=async=1:min_hard_comp=0.01:first_pts=0'
    ]
    if (this.durationSeconds !== undefined) args.push('-t', String(this.durationSeconds))
    args.push(
      '-f', 'mp4', this.rawPath,
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0',
      '-hls_flags', 'independent_segments',
      '-hls_segment_filename', join(this.hlsDir, 'seg%04d.ts'),
      join(this.hlsDir, 'index.m3u8')
    )
    return args
  }

  private async finalize(): Promise<CaptureResult> {
    const raw = await stat(this.rawPath).catch(() => null)
    if (!raw || raw.size === 0) {
      throw new Error('recording is missing or empty; ffmpeg did not produce an MP4')
    }

    // Faststart needs a second pass; the raw file is removed only after the remux succeeds.
    await run('ffmpeg', ['-y', '-v', 'error', '-i', this.rawPath, '-c', 'copy', '-movflags', '+faststart', this.mp4Path])
    await unlink(this.rawPath).catch(() => undefined)

    const mp4 = await stat(this.mp4Path)
    const durationSeconds = await this.probeDuration()
    const posterPath = await this.writePoster()
    const sha256 = await this.hashFile(this.mp4Path)
    const segments = (await readdir(this.hlsDir).catch(() => [] as string[])).filter((name) => name.endsWith('.ts')).length

    const result: CaptureResult = {
      mp4Path: this.mp4Path,
      hlsDir: this.hlsDir,
      posterPath,
      durationSeconds,
      sizeBytes: mp4.size,
      sha256,
      segments
    }
    this.logger.info('capture finalized', {
      durationSeconds,
      sizeBytes: mp4.size,
      segments,
      elapsedMs: Date.now() - this.startedAt
    })
    return result
  }

  private async probeDuration(): Promise<number> {
    const { stdout } = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', this.mp4Path
    ])
    const parsed = Number.parseFloat(stdout.trim())
    return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : 0
  }

  private async writePoster(): Promise<string | null> {
    const posterPath = join(this.sessionDir, 'poster.jpg')
    try {
      await run('ffmpeg', ['-y', '-v', 'error', '-ss', '1', '-i', this.mp4Path, '-frames:v', '1', '-q:v', '3', posterPath])
      return posterPath
    } catch (error) {
      this.logger.warn('poster generation failed', { error: String(error) })
      return null
    }
  }

  private async hashFile(path: string): Promise<string> {
    const hash = createHash('sha256')
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(path)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.once('error', reject)
      stream.once('end', () => resolve())
    })
    return hash.digest('hex')
  }
}
