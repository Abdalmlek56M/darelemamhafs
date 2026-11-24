import { useEffect, useRef, useState } from 'react'
import { fetchTurnstileConfig, loadTurnstileScript } from './turnstile'

export type TurnstileStatus = { enabled: boolean; ready: boolean; error: string | null }

type Props = {
  configUrl: string
  resetSignal?: number
  onToken: (token: string | null) => void
  onStatus?: (status: TurnstileStatus) => void
}

const SCRIPT_ERROR = 'تعذّر تحميل أداة التحقق الأمني من Cloudflare. تحقّق من اتصالك بالإنترنت ثم أعد تحميل الصفحة.'

export default function TurnstileWidget({ configUrl, resetSignal = 0, onToken, onStatus }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)
  const onStatusRef = useRef(onStatus)
  onTokenRef.current = onToken
  onStatusRef.current = onStatus

  const [enabled, setEnabled] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    onStatusRef.current?.({ enabled, ready, error })
  }, [enabled, ready, error])

  useEffect(() => {
    let disposed = false
    const removeWidget = () => {
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* the widget may already be gone */ }
      }
      widgetIdRef.current = null
    }

    const setup = async () => {
      try {
        const config = await fetchTurnstileConfig(configUrl)
        if (disposed) return
        if (!config.enabled || !config.siteKey) {
          setEnabled(false); setReady(false); setError(null); onTokenRef.current(null)
          return
        }
        setEnabled(true)
        setError(null)
        await loadTurnstileScript()
        if (disposed) return
        const container = containerRef.current
        if (!container || !window.turnstile) throw new Error('Turnstile script did not attach to the page.')
        widgetIdRef.current = window.turnstile.render(container, {
          sitekey: config.siteKey,
          action: 'login',
          language: 'ar',
          theme: 'auto',
          callback: (token: string) => { onTokenRef.current(token); setReady(true); setError(null) },
          'expired-callback': () => { onTokenRef.current(null); setReady(false) },
          'error-callback': () => { onTokenRef.current(null); setReady(false); setError('تعذّر إكمال التحقق الأمني. أعد المحاولة.') },
        })
        setReady(true)
      } catch {
        if (disposed) return
        setEnabled(true)
        setReady(false)
        setError(SCRIPT_ERROR)
        onTokenRef.current(null)
      }
    }

    void setup()
    return () => { disposed = true; removeWidget() }
  }, [configUrl, retry])

  useEffect(() => {
    if (resetSignal <= 0) return
    if (widgetIdRef.current && window.turnstile) {
      try { window.turnstile.reset(widgetIdRef.current) } catch { /* recreate below is unnecessary for the fallback */ }
    }
    setReady(false)
    onTokenRef.current(null)
  }, [resetSignal])

  if (!enabled) return null
  if (error) {
    return (
      <div className="turnstile-error" role="alert">
        <span>{error}</span>
        <button type="button" onClick={() => { setRetry(value => value + 1) }}>إعادة المحاولة</button>
      </div>
    )
  }
  return <div className="turnstile-widget" ref={containerRef} />
}
