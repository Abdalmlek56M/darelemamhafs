import type { Page } from 'playwright'
import type { Logger } from '../logger.js'

/**
 * A real calendar session, not just a URL that mentions the calendar in a continue
 * parameter: the host must be calendar.google.com and the app's Create button must exist.
 */
async function isSignedIn(page: Page): Promise<boolean> {
  try {
    const url = new URL(page.url())
    if (url.host !== 'calendar.google.com') return false
    const createButton = await page.getByRole('button', { name: /^Create$/i }).count()
    return createButton > 0
  } catch {
    return false
  }
}

/**
 * First-time Google sign-in for the bot profile.
 *
 * Google blocks scripted logins, so this opens a real Chromium window on the virtual
 * display and waits for a human to finish the flow (including 2FA). The session is then
 * stored in the persistent profile and reused for every recording.
 */
export async function runManualLogin(
  page: Page,
  logger: Logger,
  timeoutMs = 25 * 60 * 1000
): Promise<{ ok: boolean; detail: string }> {
  await page.goto('https://calendar.google.com/calendar/u/0/r', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(4000)

  if (await isSignedIn(page)) {
    logger.info('profile already signed in', { url: page.url() })
    return { ok: true, detail: 'already signed in' }
  }

  logger.warn('manual sign-in required: open the VNC session and log in with the Dar Google account', {
    url: page.url()
  })
  // Land on the sign-in form so the operator sees the email field immediately.
  await page.goto(
    'https://accounts.google.com/ServiceLogin?service=cl&continue=https%3A%2F%2Fcalendar.google.com%2Fcalendar%2Fu%2F0%2Fr',
    { waitUntil: 'domcontentloaded', timeout: 60_000 }
  ).catch(() => undefined)

  const deadline = Date.now() + timeoutMs
  let ticks = 0
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000)
    if (await isSignedIn(page)) {
      logger.info('sign-in completed', { url: page.url() })
      return { ok: true, detail: 'signed in' }
    }
    if (++ticks % 15 === 0) {
      logger.info('still waiting for the sign-in', { url: page.url(), waitedSeconds: ticks * 4 })
    }
  }
  return { ok: false, detail: 'timed out waiting for the manual sign-in' }
}

/** Confirms the stored profile still opens the calendar as a signed-in user. */
export async function verifySession(page: Page, logger: Logger): Promise<boolean> {
  await page.goto('https://calendar.google.com/calendar/u/0/r', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const ok = await isSignedIn(page)
  if (ok) logger.info('Google session verified', { url: page.url() })
  else logger.warn('stored Google session is no longer valid', { url: page.url() })
  return ok
}
