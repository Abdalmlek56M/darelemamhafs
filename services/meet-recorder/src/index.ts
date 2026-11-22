import { loadConfig } from './config.js'
import { runPoller } from './jobs/poller.js'
import { Logger } from './logger.js'
import { runSelfTest } from './selftest.js'

const mode = process.argv.includes('--selftest') ? 'selftest' : 'poller'

async function main(): Promise<void> {
  const config = loadConfig(process.env, mode)
  const logger = new Logger(config.logLevel, 'dar-meet-bot')

  if (mode === 'selftest') {
    logger.info('starting the capture self test', {
      seconds: config.selftestSeconds,
      display: `:${config.displayNumber}`,
      size: `${config.width}x${config.height}`,
      mediaRoot: config.mediaRoot
    })
    const summary = await runSelfTest(config, logger)
    process.stdout.write(`${JSON.stringify(summary)}\n`)
    process.exitCode = summary.ok ? 0 : 1
    return
  }

  const controller = new AbortController()
  const stop = (signal: string) => {
    logger.info('shutdown requested', { signal })
    controller.abort()
  }
  process.once('SIGTERM', () => stop('SIGTERM'))
  process.once('SIGINT', () => stop('SIGINT'))

  await runPoller(config, logger, controller.signal)
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: 'error', message: 'fatal', error: String(error) })}\n`)
  process.exitCode = 1
})
