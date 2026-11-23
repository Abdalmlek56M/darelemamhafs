/** Configuration for the Dar meet recorder bot (3.2). */

export type BotConfig = {
  mode: 'selftest' | 'poller'
  apiBaseUrl: string
  serviceToken: string
  workerName: string
  mediaRoot: string
  profileDir: string
  displayNumber: number
  width: number
  height: number
  framerate: number
  videoBitrate: string
  /** x264 preset; ultrafast keeps the encoder well inside the slice CPU budget. */
  videoPreset: string
  videoThreads: number
  audioBitrate: string
  diskBlockGb: number
  selftestSeconds: number
  pollIntervalMs: number
  heartbeatMs: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

function text(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name]?.trim()
  return value && value.length > 0 ? value : fallback
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}")`)
  }
  return parsed
}

/**
 * Reads BOT_* variables. The poller requires a service token; the self test does not
 * talk to the API at all, so it can run on a freshly installed host.
 */
export function loadConfig(env: NodeJS.ProcessEnv, mode: BotConfig['mode']): BotConfig {
  const width = integer(env, 'BOT_WIDTH', 1280, 640, 1920)
  const height = integer(env, 'BOT_HEIGHT', 720, 360, 1080)
  const config: BotConfig = {
    mode,
    apiBaseUrl: text(env, 'DAR_API_URL', 'http://127.0.0.1:5081').replace(/\/+$/, ''),
    serviceToken: text(env, 'DAR_SERVICE_TOKEN', ''),
    workerName: text(env, 'BOT_WORKER_NAME', 'dar-meet-bot-1'),
    mediaRoot: text(env, 'BOT_MEDIA_ROOT', '/var/lib/dar/media/meet'),
    profileDir: text(env, 'BOT_PROFILE_DIR', '/var/lib/dar/meet/profile'),
    displayNumber: integer(env, 'BOT_DISPLAY', 99, 1, 999),
    width,
    height,
    framerate: integer(env, 'BOT_FRAMERATE', 30, 10, 60),
    videoBitrate: text(env, 'BOT_VIDEO_BITRATE', '2500k'),
    videoPreset: text(env, 'BOT_VIDEO_PRESET', 'ultrafast'),
    videoThreads: integer(env, 'BOT_VIDEO_THREADS', 3, 1, 8),
    audioBitrate: text(env, 'BOT_AUDIO_BITRATE', '128k'),
    diskBlockGb: integer(env, 'BOT_DISK_BLOCK_GB', 25, 1, 500),
    selftestSeconds: integer(env, 'BOT_SELFTEST_SECONDS', 30, 5, 300),
    pollIntervalMs: integer(env, 'BOT_POLL_MS', 5000, 1000, 60000),
    heartbeatMs: integer(env, 'BOT_HEARTBEAT_MS', 15000, 5000, 120000),
    logLevel: (text(env, 'BOT_LOG_LEVEL', 'info') as BotConfig['logLevel'])
  }

  if (mode === 'poller' && config.serviceToken.length < 20) {
    throw new Error('DAR_SERVICE_TOKEN is missing or too short; the poller cannot call Dar.Api.')
  }

  return config
}
