// Does headless Chromium block LiveKit audio, and does a click unlock it?
// Real livekit-client in a real browser; no LiveKit server, app server or secrets needed.
// Usage (repo root): node tests/diagnostics/room-audio-autoplay/run.mjs
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const fromRepo = (path) => fileURLToPath(new URL(`../../../${path}`, import.meta.url))
const require = createRequire(fromRepo('services/meet-recorder/package.json'))
const { chromium } = require('playwright-core')

const ORIGIN = 'http://probe.localhost'
const FILES = {
  '/': { path: fileURLToPath(new URL('probe.html', import.meta.url)), contentType: 'text/html; charset=utf-8' },
  '/livekit.js': {
    path: fromRepo('frontend/node_modules/livekit-client/dist/livekit-client.umd.js'),
    contentType: 'text/javascript',
  },
}

/** Runs the probe page once and returns the states it logged. */
async function probe(browser, afterLoad) {
  const page = await browser.newPage()
  await page.route(`${ORIGIN}/**`, (route) => route.fulfill(FILES[new URL(route.request().url()).pathname]))
  const states = {}
  const waiters = {}
  const reached = (name) => new Promise((resolve, reject) => {
    if (states[name]) return resolve(states[name])
    const timer = setTimeout(() => reject(new Error(`probe never reached "${name}"`)), 10000)
    waiters[name] = (value) => { clearTimeout(timer); resolve(value) }
  })
  page.on('console', (message) => {
    if (!message.text().startsWith('PROBE ')) return
    const { name, ...value } = JSON.parse(message.text().slice(6))
    states[name] = value
    waiters[name]?.(value)
  })
  await page.goto(`${ORIGIN}/`)
  await afterLoad?.(page)
  const attached = await reached('attached')
  await page.mouse.click(50, 50)
  const clicked = await reached('clicked')
  await page.close()
  return { attached, clicked }
}

const cases = [
  { label: 'no automation call before audio attaches', expectBlocked: true },
  // Playwright sends evaluate/locator/screenshot with a user gesture, which unlocks audio.
  { label: 'page.evaluate before audio attaches', expectBlocked: false, afterLoad: (p) => p.evaluate(() => 1) },
]

const browser = await chromium.launch({ channel: process.env.PROBE_CHANNEL || 'chromium' })
let failed = 0
try {
  for (const { label, expectBlocked, afterLoad } of cases) {
    const { attached, clicked } = await probe(browser, afterLoad)
    const ok = attached.canPlay === !expectBlocked && attached.paused === expectBlocked
      && clicked.canPlay && !clicked.paused
    if (!ok) failed += 1
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: attached=${JSON.stringify(attached)} clicked=${JSON.stringify(clicked)}`)
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
