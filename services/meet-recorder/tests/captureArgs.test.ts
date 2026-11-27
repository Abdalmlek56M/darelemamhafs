import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCaptureArguments, isAudioOnlyCapture } from '../src/media/captureArgs.js'
import { baseConfig } from './helpers.js'

const paths = {
  rawPath: '/tmp/job/recording.raw.mp4',
  hlsDir: '/tmp/job/hls',
  hlsIndex: '/tmp/job/hls/index.m3u8'
}

describe('capture arguments (FINAL 1.23)', () => {
  it('records the virtual display and the Pulse monitor into MP4 + HLS', () => {
    const args = buildCaptureArguments(baseConfig(), ':99', 'darmeet_job.monitor', paths)
    expect(args).toContain('x11grab')
    expect(args).toContain('pulse')
    expect(args).toContain('1:a:0')
    expect(args).toContain(paths.rawPath)
    expect(args).toContain(paths.hlsIndex)
    expect(args.slice(args.indexOf('-hls_segment_filename'))).toContain(join(paths.hlsDir, 'seg%04d.ts'))
    expect(isAudioOnlyCapture(args)).toBe(false)
  })

  it('adds a fixed duration when requested', () => {
    const args = buildCaptureArguments(baseConfig(), ':99', 'src', { ...paths, durationSeconds: 30 })
    const t = args.indexOf('-t')
    expect(t).toBeGreaterThan(0)
    expect(args[t + 1]).toBe('30')
  })

  it('never asks for x11grab in audio-only mode', () => {
    expect(isAudioOnlyCapture(['-f', 'pulse'])).toBe(true)
  })
})
