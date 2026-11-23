import type { Logger } from '../logger.js'

export type BotArtifactPayload = {
  kind: string
  localPath: string
  sizeBytes: number
  sha256: string | null
  durationSeconds: number
}

export type BotStatusExtras = {
  durationSeconds?: number
  artifacts?: BotArtifactPayload[]
}

export type BotCommands = { stop: boolean; pause: boolean }

export type BotJob = {
  id: string
  eventId: string
  occurrenceKey: string
  status: string
  scheduledStart: string
  scheduledEnd: string
  joinAt: string
  stopGraceSeconds: number
  joinLeadSeconds: number
  circleId: string | null
  meetLink: string | null
  summary: string | null
}

export class DarApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/**
 * Client for the internal control-plane API. The service token is sent on every call and
 * the endpoints live outside /api/v1, so Nginx never proxies them to the internet.
 */
export class DarClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly logger: Logger
  ) {}

  async health(): Promise<{ status: string } | null> {
    return this.request<{ status: string }>('/internal/meet/health', { method: 'GET' })
  }

  async claim(): Promise<BotJob | null> {
    return this.request<BotJob>('/internal/meet/jobs/claim', { method: 'POST', body: '{}' })
  }

  /** Sends liveness + telemetry and returns the commands queued by the admin UI. */
  async heartbeat(jobId: string, participants?: number | null, audioOk?: boolean | null): Promise<BotCommands> {
    const response = await this.request<BotCommands>(`/internal/meet/jobs/${jobId}/heartbeat`, {
      method: 'POST',
      body: JSON.stringify({ participants: participants ?? null, audioOk: audioOk ?? null })
    })
    return { stop: response?.stop ?? false, pause: response?.pause ?? false }
  }

  async reportStatus(
    jobId: string,
    status: string,
    errorCode?: string,
    errorMessage?: string,
    extras?: BotStatusExtras
  ): Promise<void> {
    await this.request<unknown>(`/internal/meet/jobs/${jobId}/status`, {
      method: 'POST',
      body: JSON.stringify({
        status,
        errorCode: errorCode ?? null,
        errorMessage: errorMessage ?? null,
        durationSeconds: extras?.durationSeconds ?? 0,
        artifacts: extras?.artifacts ?? []
      })
    })
  }

  private async request<T>(path: string, init: RequestInit): Promise<T | null> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'X-Dar-Service-Token': this.token,
          ...(init.headers ?? {})
        },
        signal: AbortSignal.timeout(20_000)
      })
    } catch (error) {
      throw new DarApiError(`cannot reach ${this.baseUrl}${path}: ${String(error)}`, 0)
    }

    if (response.status === 204) return null
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new DarApiError(`${path} failed with ${response.status}: ${body.slice(0, 300)}`, response.status)
    }
    const text = await response.text()
    return text ? (JSON.parse(text) as T) : null
  }
}
