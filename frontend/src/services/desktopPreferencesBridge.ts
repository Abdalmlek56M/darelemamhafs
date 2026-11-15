type DesktopPreferenceMessage = {
  type: string
  requestId?: string
  enabled?: boolean
  success?: boolean
  error?: string
}
import type { WebViewBridge } from './desktopCredentialBridge'

export type DesktopAutoStartState = { available: boolean; enabled: boolean; error?: string }

function requestHost(type: 'getAutoStartState' | 'setAutoStart', enabled?: boolean, timeoutMs = 3500): Promise<DesktopAutoStartState> {
  const bridge = window.chrome?.webview
  if (!bridge) return Promise.resolve({ available: false, enabled: false, error: 'إعداد بدء التشغيل متاح داخل تطبيق Windows فقط.' })

  const requestId = `auto-start-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return new Promise(resolve => {
    let settled = false
    const finish = (result: DesktopAutoStartState) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      bridge.removeEventListener('message', listener)
      resolve(result)
    }
    const listener = (event: MessageEvent) => {
      const data = event.data as DesktopPreferenceMessage | undefined
      if (!data || data.requestId !== requestId) return
      if (data.type === 'autoStartState') finish({ available: true, enabled: Boolean(data.enabled), error: data.error })
      if (data.type === 'autoStartResult') finish({ available: true, enabled: Boolean(data.enabled), error: data.success ? undefined : (data.error || 'تعذر تغيير إعداد بدء التشغيل.') })
    }
    const timer = window.setTimeout(() => finish({ available: true, enabled: false, error: 'لم يستجب مشغّل Windows. أعد فتح قسم الإعدادات وحاول مرة أخرى.' }), timeoutMs)
    bridge.addEventListener('message', listener)
    try { bridge.postMessage({ type, requestId, ...(enabled === undefined ? {} : { enabled }) }) }
    catch { finish({ available: false, enabled: false, error: 'تعذر الاتصال بمشغّل Windows.' }) }
  })
}

export const getDesktopAutoStartState = () => requestHost('getAutoStartState')
export const setDesktopAutoStartState = (enabled: boolean) => requestHost('setAutoStart', enabled)
