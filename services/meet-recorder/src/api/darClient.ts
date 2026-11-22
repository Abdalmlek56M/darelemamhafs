import type { Logger } from '../logger.js'

export type BotJob = {
  id: string
  eventId: string
  occurrenceKey: string
  status: string
  scheduledStart: string
  scheduledEnd: string
  joinAt: string
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

  async heartbeat(jobId: string): Promise<void> {
    await this.request<unknown>(`/internal/meet/jobs/${jobId}/heartbeat`, { method: 'POST', body: '{}' })
  }

  async reportStatus(jobId: string, status: string, errorCode?: string, errorMessage?: string): Promise<void> {
    await this.request<unknown>(`/internal/meet/jobs/${jobId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, errorCode: errorCode ?? null, errorMessage: errorMessage ?? null })
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
    if (response.status === 204) return null
    const text = await response.text()
    return text ? (JSON.parse(text) as T) : null
  }
}
