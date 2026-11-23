import type { Page } from 'playwright'
import type { Logger } from '../logger.js'
import { isSignInPage } from './browser.js'

export type JoinState =
  | 'joined'
  | 'waiting'
  | 'guest'
  | 'signin_required'
  | 'denied'
  | 'not_found'
  | 'unknown'

export type JoinOutcome = {
  state: JoinState
  detail: string
  screenshot: string | null
}

/**
 * Joins a Google Meet link with the camera and microphone off.
 *
 * Selectors live here only (ADR-0007 R14): Google changes Meet's DOM, and this file is the
 * single place to fix it. The English UI is forced at launch so the labels are stable.
 */
export async function joinMeet(
  page: Page,
  meetUrl: string,
  screenshotPath: string,
  logger: Logger
): Promise<JoinOutcome> {
  await page.goto(meetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(3000)

  if (isSignInPage(page.url())) {
    return await finish(page, screenshotPath, logger, 'signin_required', 'Google asked for sign-in')
  }

  await turnOff(page, ['microphone', 'mic'], logger)
  await turnOff(page, ['camera'], logger)

  // The pre-join screen needs an explicit click; guests may get "Ask to join" instead.
  const joinButton = page.getByRole('button', { name: /^(Join now|Ask to join|Join)$/i }).first()
  const clicked = await joinButton.click({ timeout: 15_000 }).then(() => true).catch(() => false)
  logger.info('join button', { clicked })

  const outcome = await waitForState(page, 45_000, logger)
  return await finish(page, screenshotPath, logger, outcome.state, outcome.detail)
}

async function turnOff(page: Page, labels: string[], logger: Logger): Promise<void> {
  for (const label of labels) {
    const toggle = page.locator(`[aria-label*="${label}" i][role="button"], button[aria-label*="${label}" i]`).first()
    if (!(await toggle.count())) continue
    const pressed = await toggle.getAttribute('aria-label').catch(() => null)
    // Meet exposes "Turn off microphone" only while the device is on.
    if (pressed && /turn off|mute/i.test(pressed)) {
      await toggle.click({ timeout: 5000 }).catch(() => undefined)
      logger.info('device turned off', { label, was: pressed })
    }
    break
  }
}

async function waitForState(
  page: Page,
  timeoutMs: number,
  logger: Logger
): Promise<{ state: JoinState; detail: string }> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const body = await page.locator('body').innerText().catch(() => '')
    if (/You can't join this call|You can’t join this call|Invalid meeting|Check your meeting code/i.test(body)) {
      return { state: 'denied', detail: firstLine(body) }
    }
    // Guest pre-join screen: a name field plus "Ask to join" means the profile is not
    // signed in, so the bot would need host admission instead of joining as the organizer.
    if (/Your name/i.test(body) && /Ask to join/i.test(body)) {
      return { state: 'guest', detail: 'signed-out guest join screen' }
    }
    if (/You're the only one here|You’re the only one here|People|Chat|Leave call/i.test(body)) {
      return { state: 'joined', detail: firstLine(body) }
    }
    if (/Waiting for the host|Waiting for someone to let you in|Asking to be let in|Ask to join/i.test(body)) {
      return { state: 'waiting', detail: firstLine(body) }
    }
    logger.debug('still joining', { url: page.url() })
    await page.waitForTimeout(2000)
  }
  const body = await page.locator('body').innerText().catch(() => '')
  return { state: 'unknown', detail: firstLine(body) || 'no meeting UI detected' }
}

async function finish(
  page: Page,
  screenshotPath: string,
  logger: Logger,
  state: JoinState,
  detail: string
): Promise<JoinOutcome> {
  const screenshot = await page.screenshot({ path: screenshotPath, fullPage: false })
    .then(() => screenshotPath)
    .catch(() => null)
  logger.info('join outcome', { state, detail, screenshot })
  return { state, detail, screenshot: screenshot ? screenshotPath : null }
}

function firstLine(text: string): string {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 3).join(' | ').slice(0, 300)
}
