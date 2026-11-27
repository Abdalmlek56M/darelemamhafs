/** Configuration for the Dar meet recorder bot (3.2). */

export type BotConfig = {
  mode: 'selftest' | 'poller'
  /** 'video' records the virtual display + audio (default); 'audio' records only the meeting audio (lightweight). */
  captureMode: 'video' | 'audio'
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
  /**
   * Diagnostic: records the sink monitor to audio.wav with a tiny, higher-priority parecord,
   * next to FFmpeg. Comparing it with recording.mp4 tells an FFmpeg-side loss from a
   * Chromium-side underrun. Costs ~11 MB per minute of disk.
   */
  audioTap: boolean
  /** PULSE_LATENCY_MSEC given to Chromium only (bigger buffer against playout underruns). 0 = unset. */
  chromePulseLatencyMs: number
  /** Chromium --audio-buffer-size (samples per output buffer). 0 = Chromium default. */
  chromeAudioBuffer: number
  diskBlockGb: number
  /** Stop an active recording when free space falls below this (FINAL 1.20). */
  diskStopGb: number
  /** Delete HLS folders older than this many days; MP4 archives are kept (FINAL 1.20). */
  hlsRetentionDays: number
  /** Remove .runtime/job-* scratch dirs older than this (FINAL 1.24). */
  runtimeRetentionHours: number
  /** Consecutive low participant readings before an idle stop (FINAL 1.21). */
  idleConfirmTicks: number
  /** Admit waiting participants automatically (FINAL 1.22; can be disabled). */
  autoAdmit: boolean
  /** Attempts for the terminal-status outbox (FINAL 1.19). */
  outboxMaxAttempts: number
  selftestSeconds: number
  pollIntervalMs: number
  heartbeatMs: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

function text(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name]?.trim()
  return value && value.length > 0 ? value : fallback
}

function boolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  return !['0', 'false', 'off', 'no'].includes(raw)
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
  const captureModeRaw = text(env, 'BOT_RECORD_MODE', 'video').toLowerCase()
  if (captureModeRaw !== 'video' && captureModeRaw !== 'audio') {
    throw new Error(`BOT_RECORD_MODE must be video or audio (got "${captureModeRaw}")`)
  }
  const config: BotConfig = {
    mode,
    captureMode: captureModeRaw,
    apiBaseUrl: text(env, 'DAR_API_URL', 'http://127.0.0.1:5081').replace(/\/+$/, ''),
    serviceToken: text(env, 'DAR_SERVICE_TOKEN', ''),
    workerName: text(env, 'BOT_WORKER_NAME', 'dar-meet-bot-1'),
    mediaRoot: text(env, 'BOT_MEDIA_ROOT', '/var/lib/dar/media/meet'),
    profileDir: text(env, 'BOT_PROFILE_DIR', '/var/lib/dar/meet/profile'),
    displayNumber: integer(env, 'BOT_DISPLAY', 99, 1, 999),
    width,
    height,
    framerate: integer(env, 'BOT_FRAMERATE', 15, 10, 60),
    videoBitrate: text(env, 'BOT_VIDEO_BITRATE', '2500k'),
    videoPreset: text(env, 'BOT_VIDEO_PRESET', 'ultrafast'),
    videoThreads: integer(env, 'BOT_VIDEO_THREADS', 3, 1, 8),
    audioBitrate: text(env, 'BOT_AUDIO_BITRATE', '128k'),
    audioTap: !['0', 'false', 'off', 'no'].includes(text(env, 'BOT_AUDIO_TAP', '1').toLowerCase()),
    chromePulseLatencyMs: integer(env, 'BOT_CHROME_PULSE_LATENCY_MS', 60, 0, 500),
    chromeAudioBuffer: integer(env, 'BOT_CHROME_AUDIO_BUFFER', 16384, 0, 65536),
    diskBlockGb: integer(env, 'BOT_DISK_BLOCK_GB', 25, 1, 500),
    diskStopGb: integer(env, 'BOT_DISK_STOP_GB', 10, 1, 500),
    hlsRetentionDays: integer(env, 'BOT_HLS_RETENTION_DAYS', 30, 1, 3650),
    runtimeRetentionHours: integer(env, 'BOT_RUNTIME_RETENTION_HOURS', 24, 1, 720),
    idleConfirmTicks: integer(env, 'BOT_IDLE_CONFIRM_TICKS', 3, 1, 12),
    autoAdmit: boolean(env, 'BOT_AUTO_ADMIT', true),
    outboxMaxAttempts: integer(env, 'BOT_OUTBOX_MAX_ATTEMPTS', 5, 1, 20),
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
