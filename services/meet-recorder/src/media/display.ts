import { unlink, access } from 'node:fs/promises'
import type { Logger } from '../logger.js'
import { ManagedProcess } from './process.js'

/**
 * Xvfb-backed virtual display. Chrome renders into it and FFmpeg grabs the same
 * framebuffer, which keeps the capture path deterministic and headless.
 */
export class VirtualDisplay {
  private process: ManagedProcess | null = null

  constructor(
    private readonly number: number,
    private readonly width: number,
    private readonly height: number,
    private readonly logger: Logger
  ) {}

  get name(): string {
    return `:${this.number}`
  }

  get socket(): string {
    return `/tmp/.X11-unix/X${this.number}`
  }

  get env(): NodeJS.ProcessEnv {
    return { ...process.env, DISPLAY: this.name }
  }

  async start(): Promise<void> {
    // A killed previous run can leave the X lock behind; Xvfb then refuses to start.
    await Promise.all([
      unlink(`/tmp/.X${this.number}-lock`).catch(() => undefined),
      unlink(this.socket).catch(() => undefined)
    ])

    this.process = new ManagedProcess('xvfb', {
      command: 'Xvfb',
      args: [
        this.name,
        '-screen', '0', `${this.width}x${this.height}x24`,
        '-nolisten', 'tcp',
        '-ac',
        '-dpi', '96'
      ],
      onLine: (line, stream) => this.logger.debug('xvfb output', { stream, line })
    })
    this.process.start()

    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (await access(this.socket).then(() => true).catch(() => false)) {
        this.logger.info('virtual display ready', { display: this.name })
        return
      }
      if (!this.process.running) throw new Error('Xvfb exited before the display became ready')
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    throw new Error('timed out waiting for the Xvfb socket')
  }

  async stop(): Promise<void> {
    if (!this.process) return
    await this.process.stop(5000)
    this.process = null
    this.logger.info('virtual display stopped', { display: this.name })
  }
}
