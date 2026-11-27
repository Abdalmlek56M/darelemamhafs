import { join } from 'node:path'
import type { BotConfig } from '../config.js'

/**
 * FINAL 1.23: capture arguments are pure and unit-tested so a bad edit (e.g. dropping the
 * audio map or recording into the wrong file) fails tests instead of a live lesson.
 */
export type CapturePaths = {
  rawPath: string
  hlsDir: string
  hlsIndex: string
  durationSeconds?: number
}

export function buildCaptureArguments(config: BotConfig, display: string, audioSource: string, paths: CapturePaths): string[] {
  const { width, height, framerate, videoBitrate, audioBitrate } = config
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'warning', '-y',
    '-progress', 'pipe:1', '-stats_period', '10',
    '-thread_queue_size', '512',
    '-f', 'x11grab', '-draw_mouse', '0',
    '-framerate', String(framerate),
    '-video_size', `${width}x${height}`,
    '-i', display,
    '-thread_queue_size', '1024',
    '-f', 'pulse', '-fragment_size', '8192', '-i', audioSource,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', config.videoPreset, '-tune', 'zerolatency',
    '-threads', String(config.videoThreads),
    '-pix_fmt', 'yuv420p', '-b:v', videoBitrate, '-g', String(framerate * 2),
    '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '48000', '-ac', '2',
    '-af', 'aresample=async=1:min_hard_comp=0.01:first_pts=0'
  ]
  if (paths.durationSeconds !== undefined) args.push('-t', String(paths.durationSeconds))
  args.push(
    '-f', 'mp4', paths.rawPath,
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', join(paths.hlsDir, 'seg%04d.ts'),
    paths.hlsIndex
  )
  return args
}

/** Audio-only captures produce no HLS and must never receive x11grab arguments. */
export function isAudioOnlyCapture(args: string[]): boolean {
  return !args.includes('x11grab')
}
