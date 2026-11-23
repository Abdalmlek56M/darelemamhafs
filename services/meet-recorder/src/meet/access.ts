import type { Page } from 'playwright'
import type { Logger } from '../logger.js'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Switches the live meeting to "Open" access through the host controls panel, so nobody
 * has to ask to be admitted. Meet only exposes this to the host, so it is best effort:
 * a non-host account simply logs that the panel was unavailable.
 */
export async function openMeetingAccess(page: Page, logger: Logger): Promise<boolean> {
  const hostButton = page.locator('[aria-label*="Host controls" i]').first()
  if ((await hostButton.count().catch(() => 0)) === 0) {
    logger.info('meeting access: host controls not available for this account')
    return false
  }

  try {
    await hostButton.click({ timeout: 8000 })
    await sleep(1500)
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 700)
      await sleep(500)
    }

    // The panel offers a "Meeting access type" radio group with Open / Trusted.
    const open = page.locator('[role="radio"]', { hasText: /^Open$/ }).first()
    if ((await open.count().catch(() => 0)) > 0) {
      const checked = await open.getAttribute('aria-checked').catch(() => null)
      if (checked === 'true') {
        logger.info('meeting access already open')
        await page.keyboard.press('Escape').catch(() => undefined)
        return true
      }
      await open.click({ timeout: 6000 })
      await sleep(1200)
      logger.info('meeting access switched to Open')
      await page.keyboard.press('Escape').catch(() => undefined)
      return true
    }

    // Fallback: the group may render as plain buttons with the option text.
    const option = page.getByText(/^Open$/, { exact: true }).first()
    if ((await option.count().catch(() => 0)) > 0) {
      await option.click({ timeout: 6000 })
      await sleep(800)
      logger.info('meeting access switched to Open (text option)')
      await page.keyboard.press('Escape').catch(() => undefined)
      return true
    }

    logger.warn('meeting access: Open option not found in host controls')
    await page.keyboard.press('Escape').catch(() => undefined)
    return false
  } catch (error) {
    logger.warn('meeting access: could not switch to Open', { error: String(error).slice(0, 160) })
    await page.keyboard.press('Escape').catch(() => undefined)
    return false
  }
}

/**
 * Admits knocking participants. The bot is the meeting host, so anyone who still has to
 * ask is let in within a few seconds instead of waiting for a human.
 */
export async function admitWaiting(page: Page, logger: Logger): Promise<number> {
  const state = await page
    .evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const admit = buttons.filter((button) => {
        const label = `${button.getAttribute('aria-label') ?? ''} ${button.innerText ?? ''}`
        return /^\s*(admit|admit all|let in)\b/i.test(label.trim()) || /\badmit all\b/i.test(label)
      })
      admit.forEach((button) => (button as HTMLElement).click())
      return admit.length
    })
    .catch(() => 0)

  if (state > 0) logger.info('admitted waiting participants', { count: state })
  return state
}
