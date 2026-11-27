import { expect, it } from 'vitest'
import type { BotConfig } from '../src/config.js'

export function baseConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    mode: 'poller',
    captureMode: 'video',
    apiBaseUrl: 'http://127.0.0.1:5081',
    serviceToken: 'x'.repeat(32),
    workerName: 'test-bot',
    mediaRoot: '/tmp/dar-meet-test',
    profileDir: '/tmp/dar-meet-profile',
    displayNumber: 99,
    width: 1280,
    height: 720,
    framerate: 15,
    videoBitrate: '2500k',
    videoPreset: 'ultrafast',
    videoThreads: 3,
    audioBitrate: '128k',
    audioTap: true,
    chromePulseLatencyMs: 60,
    chromeAudioBuffer: 16384,
    diskBlockGb: 25,
    diskStopGb: 10,
    hlsRetentionDays: 30,
    runtimeRetentionHours: 24,
    idleConfirmTicks: 3,
    autoAdmit: true,
    outboxMaxAttempts: 5,
    selftestSeconds: 30,
    pollIntervalMs: 5000,
    heartbeatMs: 15000,
    logLevel: 'info',
    ...overrides
  }
}

export function silentLogger() {
  return { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined }
}

export function expectDefined<T>(value: T | null | undefined): T {
  expect(value).toBeTruthy()
  return value as T
}
