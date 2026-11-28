// Participant tiles in the meeting stage must never overlap and must all be reachable by scroll.
// Renders the real room.css in a real browser; no app server or secrets needed.
// Usage (repo root): node tests/diagnostics/room-stage-layout/run.mjs
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const fromRepo = (path) => fileURLToPath(new URL(`../../../${path}`, import.meta.url))
const require = createRequire(fromRepo('services/meet-recorder/package.json'))
const { chromium } = require('playwright-core')

const css = readFileSync(fromRepo('frontend/src/room/room.css'), 'utf8')
const VIEWPORTS = [[360, 640], [390, 844], [1280, 720]]
const COUNTS = [1, 3, 12]

// Mirrors the markup of MeetingRoomView + RoomTile around the stage.
const tile = (i) => `<article class="room-tile"><div class="room-tile-avatar">م</div>
  <div class="room-tile-footer"><span class="room-tile-name"><span class="room-tile-label">مشاركة ${i}</span></span>
  <span class="room-tile-mic">🎤</span></div></article>`
const page_ = (count, banner) => `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}${css}</style>
<div class="room-shell"><header class="room-topbar" style="height:61px">حلقة</header>
${banner ? '<div class="room-audio-banner" style="height:96px">الصوت</div>' : ''}
<div class="room-body"><div class="room-main-area"><div class="room-stage">
${Array.from({ length: count }, (_, i) => tile(i + 1)).join('')}</div></div></div>
<div class="room-controls" style="height:68px"></div></div>`

function measure() {
  const stage = document.querySelector('.room-stage')
  const tiles = [...stage.querySelectorAll('.room-tile')]
  const rects = tiles.map((el) => el.getBoundingClientRect())
  const overlaps = rects.flatMap((a, i) => rects.slice(i + 1).filter((b) =>
    a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)).length
  stage.scrollTop = stage.scrollHeight
  const lastBottom = tiles.at(-1).getBoundingClientRect().bottom
  return {
    overlaps,
    lastReachable: lastBottom <= stage.getBoundingClientRect().bottom + 1,
    sideScroll: document.documentElement.scrollWidth > window.innerWidth,
    minHeight: Math.round(Math.min(...rects.map((r) => r.height))),
  }
}

const browser = await chromium.launch({ channel: process.env.PROBE_CHANNEL || 'chromium' })
let failed = 0
try {
  const page = await browser.newPage()
  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height })
    for (const count of COUNTS) {
      for (const banner of [false, true]) {
        await page.setContent(page_(count, banner))
        const result = await page.evaluate(measure)
        const ok = result.overlaps === 0 && result.lastReachable && !result.sideScroll && result.minHeight >= 132
        if (!ok) failed += 1
        console.log(`${ok ? 'PASS' : 'FAIL'} ${width}x${height} tiles=${count} banner=${banner} ${JSON.stringify(result)}`)
      }
    }
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
