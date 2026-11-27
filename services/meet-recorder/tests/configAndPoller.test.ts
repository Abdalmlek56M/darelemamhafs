import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { pollOnce } from '../src/jobs/poller.js'
import { StatusOutbox } from '../src/api/outbox.js'
import { baseConfig, silentLogger } from './helpers.js'
import type { DarClient, BotJob } from '../src/api/darClient.js'

describe('bot config (FINAL 1.23)', () => {
  it('applies safe defaults', () => {
    const config = loadConfig({ DAR_SERVICE_TOKEN: 'x'.repeat(24) } as NodeJS.ProcessEnv, 'poller')
    expect(config.captureMode).toBe('video')
    expect(config.autoAdmit).toBe(true)
    expect(config.idleConfirmTicks).toBe(3)
    expect(config.hlsRetentionDays).toBe(30)
    expect(config.diskStopGb).toBeGreaterThan(0)
  })

  it('validates values and allows disabling auto-admit', () => {
    expect(() => loadConfig({ BOT_RECORD_MODE: 'nope', DAR_SERVICE_TOKEN: 'x'.repeat(24) } as NodeJS.ProcessEnv, 'poller')).toThrow()
    const config = loadConfig({ BOT_AUTO_ADMIT: '0', DAR_SERVICE_TOKEN: 'x'.repeat(24) } as NodeJS.ProcessEnv, 'poller')
    expect(config.autoAdmit).toBe(false)
  })
})

describe('poller iteration (FINAL 1.23)', () => {
  it('is idle when no job is claimed', async () => {
    const client = { claim: async () => null, reportStatus: async () => undefined } as unknown as DarClient
    const outbox = new StatusOutbox('/tmp/dar-meet-poller-test-outbox', async () => undefined)
    const result = await pollOnce(client, outbox, baseConfig(), silentLogger())
    expect(result).toBe('idle')
  })

  it('runs the job it claimed', async () => {
    const job = { id: 'j1', meetLink: 'https://meet.google.com/abc' } as BotJob
    const client = { claim: async () => job, reportStatus: async () => undefined } as unknown as DarClient
    const outbox = new StatusOutbox('/tmp/dar-meet-poller-test-outbox', async () => undefined)
    let ran = false
    const result = await pollOnce(client, outbox, baseConfig(), silentLogger(), (async () => { ran = true }) as never)
    expect(result).toBe('ran')
    expect(ran).toBe(true)
  })
})
