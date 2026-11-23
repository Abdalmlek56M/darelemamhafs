import { join } from 'node:path'
import { loadConfig } from './config.js'
import { runPoller } from './jobs/poller.js'
import { Logger } from './logger.js'
import { runSelfTest } from './selftest.js'
import { runManualLogin } from './meet/auth.js'
import { launchBrowser } from './meet/browser.js'
import { joinMeet } from './meet/join.js'
import { VirtualDisplay } from './media/display.js'

type Mode = 'selftest' | 'poller' | 'login' | 'join'

function parseMode(argv: string[]): { mode: Mode; joinUrl?: string } {
  if (argv.includes('--selftest')) return { mode: 'selftest' }
  if (argv.includes('--login')) return { mode: 'login' }
  const index = argv.indexOf('--join')
  if (index >= 0) {
    const url = argv[index + 1]
    if (!url) throw new Error('--join needs a Google Meet URL')
    return { mode: 'join', joinUrl: url }
  }
  return { mode: 'poller' }
}

async function main(): Promise<void> {
  const { mode, joinUrl } = parseMode(process.argv.slice(2))
  const config = loadConfig(process.env, mode === 'poller' ? 'poller' : 'selftest')
  const logger = new Logger(config.logLevel, 'dar-meet-bot')

  if (mode === 'selftest') {
    logger.info('starting the capture self test', { seconds: config.selftestSeconds })
    const summary = await runSelfTest(config, logger)
    process.stdout.write(`${JSON.stringify(summary)}\n`)
    process.exitCode = summary.ok ? 0 : 1
    return
  }

  if (mode === 'login' || mode === 'join') {
    const display = new VirtualDisplay(config.displayNumber, config.width, config.height, logger)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const shot = join(config.mediaRoot, `browser-${mode}-${stamp}.png`)
    let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null
    try {
      await display.start()
      browser = await launchBrowser(config.profileDir, display.name, logger)
      if (mode === 'login') {
        const result = await runManualLogin(browser.page, logger)
        await browser.page.screenshot({ path: shot }).catch(() => undefined)
        process.stdout.write(`${JSON.stringify({ mode, ...result, screenshot: shot })}\n`)
        process.exitCode = result.ok ? 0 : 1
      } else {
        const outcome = await joinMeet(browser.page, joinUrl!, join(config.mediaRoot, `join-${stamp}.png`), logger)
        await browser.page.waitForTimeout(5000)
        process.stdout.write(`${JSON.stringify({ mode, url: joinUrl, ...outcome })}\n`)
        process.exitCode = outcome.state === 'joined' ? 0 : 1
      }
    } finally {
      await browser?.context.close().catch(() => undefined)
      await display.stop().catch(() => undefined)
    }
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
