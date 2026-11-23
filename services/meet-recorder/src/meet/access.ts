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
 * ask is let in within a few seconds instead of waiting for a human. Meet renders a
 * "guest waiting" chip first, so that is clicked before looking for the Admit button.
 */
export async function admitWaiting(page: Page, logger: Logger): Promise<number> {
  const state = await page
    .evaluate(() => {
      let clicks = 0
      const chips = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter((element) => /guest waiting|waiting to join|wants to join/i.test(
          `${element.getAttribute('aria-label') ?? ''} ${(element as HTMLElement).innerText ?? ''}`))
      chips.forEach((chip) => {
        ;(chip as HTMLElement).click()
        clicks += 1
      })
      return clicks
    })
    .catch(() => 0)

  if (state > 0) await sleep(1200)

  const admitted = await page
    .evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const admit = buttons.filter((button) => {
        const label = `${button.getAttribute('aria-label') ?? ''} ${button.innerText ?? ''}`.trim()
        return /^(admit|admit all|let in|let them in)\b/i.test(label)
      })
      admit.forEach((button) => (button as HTMLElement).click())
      return admit.length
    })
    .catch(() => 0)

  if (state > 0 || admitted > 0) {
    logger.info('admitted waiting participants', { chips: state, buttons: admitted })
  }
  return state + admitted
}

/**
 * Reads the participant count from Meet's counter button (the small number next to the
 * people icon). Returns null when the UI does not expose it yet.
 */
export async function countParticipants(page: Page): Promise<number | null> {
  return page
    .evaluate(() => {
      const labelled = Array.from(document.querySelectorAll('button, [role="button"]'))
        .map((element) => element.getAttribute('aria-label') ?? '')
        .map((label) => label.match(/(\d+)\s*(participant|people|in the call)/i))
        .find((match) => match)
      if (labelled) return Number(labelled[1])

      const counter = Array.from(document.querySelectorAll('button'))
        .map((button) => (button.innerText ?? '').trim())
        .find((text) => /^\d{1,3}$/.test(text))
      return counter ? Number(counter) : null
    })
    .catch(() => null)
}
