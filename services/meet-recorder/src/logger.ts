/** Structured JSON logger: every line is one object so journalctl stays greppable. */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export class Logger {
  constructor(
    private readonly level: LogLevel,
    private readonly scope: string
  ) {}

  child(scope: string): Logger {
    return new Logger(this.level, `${this.scope}.${scope}`)
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.write('debug', message, fields)
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.write('info', message, fields)
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.write('warn', message, fields)
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.write('error', message, fields)
  }

  private write(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (order[level] < order[this.level]) return
    const line = { ts: new Date().toISOString(), level, scope: this.scope, message, ...fields }
    const target = level === 'error' || level === 'warn' ? process.stderr : process.stdout
    target.write(`${JSON.stringify(line)}\n`)
  }
}
