import { mkdir, statfs } from 'node:fs/promises'

const GB = 1024 * 1024 * 1024

/** Free space of the filesystem that holds `path`, in rounded-down gigabytes. */
export async function freeGigabytes(path: string): Promise<number> {
  await mkdir(path, { recursive: true })
  const stats = await statfs(path)
  return Math.floor((stats.bavail * stats.bsize) / GB)
}

/** FINAL 1.20: the disk is checked during recording too, not only at start. */
export function shouldStopForDisk(freeGb: number, stopBelowGb: number): boolean {
  return freeGb < stopBelowGb
}

/**
 * ADR-0007: never start a recording when the disk is below the owner's threshold.
 * Failing here keeps the site and PostgreSQL safe instead of filling the disk.
 */
export async function assertFreeSpace(path: string, minimumGb: number): Promise<number> {
  const free = await freeGigabytes(path)
  if (free < minimumGb) {
    throw new Error(`disk guard: ${free}GB free is below the ${minimumGb}GB recording threshold`)
  }
  return free
}
