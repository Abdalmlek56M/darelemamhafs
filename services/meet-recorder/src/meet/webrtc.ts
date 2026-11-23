import type { Page } from 'playwright'

/** One inbound audio stream as reported by WebRTC inside the Meet page. */
export type WebRtcAudioStats = {
  lost: number
  recv: number
  jitter: number
  concealed: number
  total: number
  events: number
}

export type WebRtcAudioReport = {
  /** Number of RTCPeerConnection instances the page created (0 means the hook missed them). */
  peers: number
  /** False when the init script did not manage to wrap the constructor. */
  hooked: boolean
  /** Distinct stat types present (diagnostic: proves whether inbound-rtp exists at all). */
  types: string[]
  stats: WebRtcAudioStats[]
}

/**
 * Reads Google Meet's own WebRTC reception counters through the RTCPeerConnection
 * instances captured by the init script (meet/browser.ts). They separate "the network
 * dropped audio" from "our recorder dropped audio", which the file alone cannot tell.
 */
export async function collectWebRtcAudio(page: Page): Promise<WebRtcAudioReport> {
  return page
    .evaluate(async () => {
      const scope = window as unknown as {
        __pcs?: RTCPeerConnection[]
        __pcsHooked?: boolean
      }
      const peers = scope.__pcs?.length ?? 0
      const hooked = scope.__pcsHooked === true
      const rows: Array<Record<string, number>> = []
      const types = new Set<string>()

      for (const pc of scope.__pcs ?? []) {
        try {
          const report = await pc.getStats()
          report.forEach((entry) => {
            const stat = entry as unknown as Record<string, unknown>
            types.add(`${String(stat.type)}:${String(stat.kind ?? stat.mediaType ?? '-')}`)
            const isAudio = stat.kind === 'audio' || stat.mediaType === 'audio'
            if (stat.type !== 'inbound-rtp' || !isAudio) return
            rows.push({
              lost: Number(stat.packetsLost ?? 0),
              recv: Number(stat.packetsReceived ?? 0),
              jitter: Number(stat.jitter ?? 0),
              concealed: Number(stat.concealedSamples ?? 0),
              total: Number(stat.totalSamplesReceived ?? 0),
              events: Number(stat.concealmentEvents ?? 0)
            })
          })
        } catch {
          // A closed peer connection throws; the next tick picks up the new one.
        }
      }
      return { peers, hooked, types: Array.from(types).slice(0, 12), stats: rows }
    })
    .then((report) => ({
      peers: Number(report?.peers ?? 0),
      hooked: report?.hooked === true,
      types: (report?.types ?? []) as string[],
      stats: (report?.stats ?? []) as WebRtcAudioStats[]
    }))
    .catch(() => ({ peers: 0, hooked: false, types: [] as string[], stats: [] as WebRtcAudioStats[] }))
}
