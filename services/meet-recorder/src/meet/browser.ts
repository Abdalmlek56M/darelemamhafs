import { chromium, type BrowserContext, type Page } from 'playwright'
import type { Logger } from '../logger.js'

export type LaunchedBrowser = { context: BrowserContext; page: Page }

/**
 * Reveals the persistent Chromium profile on the Xvfb display.
 *
 * The profile keeps the Dar Google session between runs (ADR-0007): the first login is
 * manual, then every recording reuses it. English UI is forced so the Meet selectors stay
 * stable regardless of the host locale.
 */
export async function launchBrowser(
  profileDir: string,
  display: string,
  logger: Logger
): Promise<LaunchedBrowser> {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    timezoneId: 'Africa/Cairo',
    env: { ...process.env, DISPLAY: display, LANG: 'en_US.UTF-8' },
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--hide-crash-restore-bubble',
      '--disable-session-crashed-bubble',
      '--lang=en-US',
      '--window-size=1280,720',
      '--start-maximized'
    ]
  })

  const page = context.pages()[0] ?? (await context.newPage())
  page.setDefaultTimeout(30_000)
  logger.info('browser launched', { profileDir, display, pages: context.pages().length })
  return { context, page }
}

/** True when the page is sitting on a Google sign-in screen. */
export function isSignInPage(url: string): boolean {
  return /accounts\.google\.com|ServiceLogin|signin\/v2/i.test(url)
}
