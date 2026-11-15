import type { WebViewBridge } from './desktopCredentialBridge'

type ConnectionSettingsMessage = { type?: string; requestId?: string; success?: boolean; error?: string }

/** Opens the native connection settings dialog from the trusted local Windows desktop UI. */
export function openDesktopConnectionSettings(timeoutMs = 5000): Promise<{ available: boolean; error?: string }> {
  const bridge = window.chrome?.webview as WebViewBridge | undefined
  if (!bridge) return Promise.resolve({ available: false, error: 'إعداد الاتصال متاح داخل نسخة Windows Desktop فقط.' })

  const requestId = `connection-settings-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return new Promise(resolve => {
    let settled = false
    const finish = (result: { available: boolean; error?: string }) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      bridge.removeEventListener('message', listener)
      resolve(result)
    }
    const listener = (event: MessageEvent) => {
      const data = event.data as ConnectionSettingsMessage | undefined
      if (!data || data.requestId !== requestId || data.type !== 'connectionSettingsOpened') return
      finish(data.success ? { available: true } : { available: false, error: data.error || 'تعذر فتح إعداد الاتصال.' })
    }
    const timer = window.setTimeout(() => finish({ available: false, error: 'لم يستجب مشغّل Windows. أعد فتح إعدادات الدار وحاول مرة أخرى.' }), timeoutMs)
    bridge.addEventListener('message', listener)
    try { bridge.postMessage({ type: 'openConnectionSettings', requestId }) }
    catch { finish({ available: false, error: 'تعذر الاتصال بمشغّل Windows.' }) }
  })
}
