import { mkdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Logger } from '../logger.js'
import { ManagedProcess } from './process.js'

const run = promisify(execFile)

/**
 * PulseAudio null sink, owned by the bot process itself.
 *
 * `pulseaudio --start` daemonises and dies with the login session, which broke capture on
 * the server. Running it as a supervised child keeps one private server per worker: the
 * bot's lifetime is the server's lifetime, and stopping the service leaves nothing behind.
 */
export class NullAudioSink {
  private process: ManagedProcess | null = null
  private moduleId: string | null = null

  constructor(
    private readonly sinkName: string,
    private readonly runtimeDir: string,
    private readonly logger: Logger
  ) {}

  get monitorSource(): string {
    return `${this.sinkName}.monitor`
  }

  get env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      XDG_RUNTIME_DIR: this.runtimeDir,
      PULSE_RUNTIME_PATH: join(this.runtimeDir, 'pulse')
    }
  }

  async start(): Promise<void> {
    await mkdir(this.runtimeDir, { recursive: true, mode: 0o700 })

    this.process = new ManagedProcess('pulseaudio', {
      command: 'pulseaudio',
      args: ['--daemonize=no', '--exit-idle-time=-1', '--log-target=stderr', '--log-level=warn'],
      env: this.env,
      onLine: (line, stream) => this.logger.debug('pulseaudio', { stream, line })
    })
    this.process.start()

    const socket = join(this.runtimeDir, 'pulse', 'native')
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (await access(socket).then(() => true).catch(() => false)) break
      if (!this.process.running) throw new Error('PulseAudio exited before its socket was ready')
      await new Promise((resolve) => setTimeout(resolve, 150))
    }

    const { stdout } = await run('pactl', [
      'load-module', 'module-null-sink',
      `sink_name=${this.sinkName}`,
      'sink_properties=device.description=DarMeet'
    ], { env: this.env })
    this.moduleId = stdout.trim()
    this.logger.info('null audio sink ready', { sink: this.sinkName, moduleId: this.moduleId, socket })
  }

  async stop(): Promise<void> {
    if (this.moduleId) {
      await run('pactl', ['unload-module', this.moduleId], { env: this.env }).catch((error: unknown) => {
        this.logger.warn('could not unload the null sink', { error: String(error) })
      })
      this.moduleId = null
    }
    if (this.process) {
      await this.process.stop(3000)
      this.process = null
    }
  }
}
