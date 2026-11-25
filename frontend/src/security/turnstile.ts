/** Runtime Cloudflare Turnstile helpers. No site/secret key is ever bundled in the app. */
import { normalizeUserMessage } from '../lib/userMessages'
export type TurnstileConfig = { enabled: boolean; siteKey: string | null }

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<void> | null = null

export async function fetchTurnstileConfig(configUrl: string): Promise<TurnstileConfig> {
  let response: Response
  try {
    response = await fetch(configUrl, { credentials: 'include', cache: 'no-store' })
  } catch (error) {
    throw new Error(normalizeUserMessage(error instanceof Error ? error.message : null, 0))
  }
  if (!response.ok) throw new Error(normalizeUserMessage(null, response.status))
  const body = await response.json() as { enabled?: unknown; siteKey?: unknown }
  const enabled = body.enabled === true && typeof body.siteKey === 'string' && body.siteKey.length > 0
  return { enabled, siteKey: enabled ? body.siteKey as string : null }
}

export function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Turnstile is only available in the browser.'))
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-dar-turnstile]')
    if (existing) {
      if (existing.dataset.loaded === 'true') { resolve(); return }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('تعذّر تحميل سكربت Cloudflare Turnstile.')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.darTurnstile = 'true'
    script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve() }, { once: true })
    script.addEventListener('error', () => { scriptPromise = null; reject(new Error('تعذّر تحميل سكربت Cloudflare Turnstile.')) }, { once: true })
    document.head.appendChild(script)
  })
  return scriptPromise
}