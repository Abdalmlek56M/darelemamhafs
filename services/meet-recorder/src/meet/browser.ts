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
  logger: Logger,
  extraEnv: NodeJS.ProcessEnv = {},
  extraArgs: string[] = []
): Promise<LaunchedBrowser> {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    timezoneId: 'Africa/Cairo',
    // The audio env must reach Chromium too: it plays the meeting into the null sink that
    // FFmpeg records, and without PULSE_SERVER the recording comes out silent.
    env: { ...process.env, ...extraEnv, DISPLAY: display, LANG: 'en_US.UTF-8' },
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // Kiosk removes the tab strip and URL bar, so the recording contains the meeting
      // only (1280x720 matches the Xvfb screen exactly).
      '--kiosk',
      '--start-fullscreen',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--hide-crash-restore-bubble',
      '--disable-session-crashed-bubble',
      '--lang=en-US',
      '--window-size=1280,720',
      '--start-maximized',
      ...extraArgs
    ]
  })

  const page = context.pages()[0] ?? (await context.newPage())
  page.setDefaultTimeout(30_000)

  // Must run before any Meet navigation: keeps a handle on every RTCPeerConnection so the
  // recording loop can log Google's inbound-audio counters (loss, jitter, concealment).
  await context.addInitScript(() => {
    const scope = window as unknown as { __pcs?: RTCPeerConnection[]; __pcsHooked?: boolean; RTCPeerConnection?: unknown }
    const Original = scope.RTCPeerConnection
    if (typeof Original !== 'function') return
    scope.__pcs = []
    scope.__pcsHooked = true
    const Patched = function (this: unknown, ...args: unknown[]) {
      const pc = new (Original as new (...rest: unknown[]) => RTCPeerConnection)(...args)
      ;(scope.__pcs as RTCPeerConnection[]).push(pc)
      return pc
    } as unknown as typeof RTCPeerConnection
    Patched.prototype = (Original as { prototype: RTCPeerConnection }).prototype
    scope.RTCPeerConnection = Patched
  })

  // Kiosk/fullscreen flags are ignored by Playwright's launcher; CDP does it reliably and
  // the recording then contains the meeting only, without the tab strip and URL bar.
  try {
    const session = await context.newCDPSession(page)
    const { windowId } = await session.send('Browser.getWindowForTarget')
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } })
  } catch (error) {
    logger.warn('could not switch the browser window to fullscreen', { error: String(error).slice(0, 120) })
  }

  logger.info('browser launched', { profileDir, display, pages: context.pages().length })
  return { context, page }
}

/** True when the page is sitting on a Google sign-in screen. */
export function isSignInPage(url: string): boolean {
  return /accounts\.google\.com|ServiceLogin|signin\/v2/i.test(url)
}
