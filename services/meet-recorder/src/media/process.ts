import { spawn, type ChildProcess } from 'node:child_process'

export type LineHandler = (line: string, stream: 'stdout' | 'stderr') => void

export type LaunchSpec = {
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
  onLine?: LineHandler
}

/**
 * Small wrapper around child_process.spawn: keeps the last output lines for diagnostics,
 * supports a graceful stop (SIGINT first, SIGKILL after the timeout) and always resolves
 * exactly once so the caller never awaits a dead process.
 */
export class ManagedProcess {
  private child: ChildProcess | null = null
  private exitCode: number | null = null
  private readonly tail: string[] = []
  private exited: Promise<number | null> = Promise.resolve(null)

  constructor(
    private readonly name: string,
    private readonly spec: LaunchSpec
  ) {}

  get pid(): number | undefined {
    return this.child?.pid
  }

  get running(): boolean {
    return this.child !== null && this.exitCode === null
  }

  get lastLines(): string[] {
    return [...this.tail]
  }

  start(): void {
    if (this.child) throw new Error(`${this.name} is already running`)
    const child = spawn(this.spec.command, this.spec.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: this.spec.env ?? process.env
    })
    this.child = child
    this.exitCode = null

    const capture = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      for (const raw of chunk.toString('utf8').split('\n')) {
        const line = raw.trimEnd()
        if (!line) continue
        this.tail.push(line)
        if (this.tail.length > 40) this.tail.shift()
        this.spec.onLine?.(line, stream)
      }
    }
    child.stdout?.on('data', capture('stdout'))
    child.stderr?.on('data', capture('stderr'))

    this.exited = new Promise<number | null>((resolve) => {
      child.once('error', (error) => {
        this.tail.push(`spawn error: ${error.message}`)
        this.exitCode = -1
        resolve(-1)
      })
      child.once('exit', (code, signal) => {
        this.exitCode = code ?? (signal ? -1 : 0)
        resolve(this.exitCode)
      })
    })
  }

  async wait(timeoutMs?: number): Promise<number | null> {
    if (!this.child) return null
    if (timeoutMs === undefined) return this.exited
    const timer = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    return Promise.race([this.exited, timer])
  }

  async stop(graceMs = 8000): Promise<number | null> {
    if (!this.child || this.exitCode !== null) return this.exitCode
    this.child.kill('SIGINT')
    const result = await this.wait(graceMs)
    if (result === null) {
      this.child.kill('SIGKILL')
      return this.wait(3000)
    }
    return result
  }

  /** Sends an arbitrary signal (SIGSTOP/SIGCONT for pause and resume). */
  signal(signal: NodeJS.Signals): boolean {
    if (!this.child || this.exitCode !== null) return false
    try {
      return this.child.kill(signal)
    } catch {
      return false
    }
  }
}
