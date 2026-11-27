import type { Page } from 'playwright'
import type { Logger } from '../logger.js'
import { isSignInPage } from './browser.js'
import { sleep } from '../lib/sleep.js'

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

  // The account may still be joined from a previous run: Meet then shows "Switch here".
  const switchHere = page.getByRole('button', { name: /Switch here/i }).first()
  if (await switchHere.count().catch(() => 0)) {
    logger.warn('taking over an existing call from another device', { url: page.url() })
    await switchHere.click({ timeout: 10_000 }).catch(() => undefined)
    await page.waitForTimeout(4000)
  }

  // The pre-join screen needs an explicit click; guests may get "Ask to join" instead.
  const joinButton = page.getByRole('button', { name: /^(Join now|Ask to join|Join)$/i }).first()
  const clicked = await joinButton.click({ timeout: 15_000 }).then(() => true).catch(() => false)
  logger.info('join button', { clicked })

  const outcome = await waitForState(page, 60_000, logger)
  return await finish(page, screenshotPath, logger, outcome.state, outcome.detail)
}

/** Leaves the call so the account is not left "joined" for the next run. */
export async function leaveCall(page: Page, logger: Logger): Promise<void> {
  const leave = page.locator('[aria-label*="Leave call" i]').first()
  if (await leave.count().catch(() => 0)) {
    await leave.click({ timeout: 5000 }).catch(() => undefined)
    await page.waitForTimeout(2500)
    logger.info('left the meeting')
  }
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

type PageState = {
  hasLeave: boolean
  hasJoinButton: boolean
  bodyStart: string
  url: string
  error: string | null
}

/**
 * Reads the page state in one round trip. Meet renders its call UI in the same document,
 * but Playwright's CSS engine did not match the leave-call button while querySelectorAll
 * does, so this probe stays inside document APIs.
 */
async function probePageState(page: Page): Promise<PageState> {
  return page
    .evaluate(() => {
      const body = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim()
      const buttons = Array.from(document.querySelectorAll('button'))
      return {
        hasLeave: buttons.some((button) => /leave call|leave the call/i.test(button.getAttribute('aria-label') ?? '')),
        hasJoinButton: buttons.some((button) => /^(join now|ask to join|join)$/i.test((button.innerText ?? '').trim())),
        bodyStart: body.slice(0, 120),
        url: location.href,
        error: null
      }
    })
    .catch((error: unknown) => ({
      hasLeave: false,
      hasJoinButton: true,
      bodyStart: '',
      url: page.url(),
      error: String(error).slice(0, 200)
    }))
}

async function waitForState(
  page: Page,
  timeoutMs: number,
  logger: Logger
): Promise<{ state: JoinState; detail: string }> {
  const deadline = Date.now() + timeoutMs
  let last: PageState | null = null

  while (Date.now() < deadline) {
    last = await probePageState(page)
    if (last.hasLeave) {
      return { state: 'joined', detail: 'in-call controls present' }
    }
    if (/You're the only one here|You’re the only one here/i.test(last.bodyStart)) {
      return { state: 'joined', detail: 'only participant banner' }
    }
    if (/You can't join this call|You can’t join this call|Invalid meeting|Check your meeting code/i.test(last.bodyStart)) {
      return { state: 'denied', detail: last.bodyStart }
    }
    if (/Your name/i.test(last.bodyStart) && /Ask to join/i.test(last.bodyStart)) {
      return { state: 'guest', detail: 'signed-out guest join screen' }
    }
    if (/Waiting for the host|Waiting for someone to let you in|Asking to be let in/i.test(last.bodyStart)) {
      return { state: 'waiting', detail: last.bodyStart }
    }
    await page.waitForTimeout(2000)
  }

  const suffix = last?.error ? ` | probe error: ${last.error}` : ''
  return {
    state: 'unknown',
    detail: `${last?.bodyStart.slice(0, 100) ?? 'no meeting UI'}${suffix}`
  }
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