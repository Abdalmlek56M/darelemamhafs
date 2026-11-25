import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dist = resolve(process.argv[2] || 'dist')
const swPath = join(dist, 'sw.js')
const assetsDir = join(dist, 'assets')

try {
  const index = readFileSync(join(dist, 'index.html'))
  const assetNames = readdirSync(assetsDir).sort()
  if (assetNames.length === 0) throw new Error('No built assets found.')
  const payload = Buffer.concat(assetNames.map((name) => readFileSync(join(assetsDir, name))))
  const buildId = createHash('sha256')
    .update(index)
    .update(payload)
    .update(Date.now().toString())
    .digest('hex')
    .slice(0, 12)
  if (!/^[a-f0-9]{12}$/.test(buildId)) throw new Error('Service worker build id is empty or invalid.')
  const sw = readFileSync(swPath, 'utf8')
  if (!sw.includes('__BUILD_ID__')) throw new Error('Service worker build placeholder is missing.')
  const stamped = sw.replaceAll('__BUILD_ID__', buildId)
  if (stamped.includes('__BUILD_ID__')) throw new Error('Service worker build placeholder was not fully replaced.')
  writeFileSync(swPath, stamped)
  console.log('Service worker cache: dar-shell-' + buildId)
} catch (error) {
  console.error('Service worker stamping failed:', error instanceof Error ? error.message : error)
  process.exit(1)
}
