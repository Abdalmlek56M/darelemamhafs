type WebViewMessage = { type: string; username?: string; password?: string | null; displayName?: string }
export type WebViewBridge = {
  postMessage: (message: unknown) => void
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
  removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
}
declare global {
  interface Window { chrome?: { webview?: WebViewBridge } }
}

export function saveDesktopCredential(username: string, password: string, displayName: string) {
  try { window.chrome?.webview?.postMessage({ type: 'saveCredential', username, password, displayName } satisfies WebViewMessage) } catch { /* Browser-based development has no Windows credential bridge. */ }
}

export function updateDesktopCredentialIfSaved(username: string, password: string, displayName: string) {
  try { window.chrome?.webview?.postMessage({ type: 'updateCredential', username, password, displayName } satisfies WebViewMessage) } catch { /* Optional desktop-only integration. */ }
}

export function deleteDesktopCredential(username: string) {
  try { window.chrome?.webview?.postMessage({ type: 'deleteCredential', username } satisfies WebViewMessage) } catch { /* Browser-based development has no Windows credential bridge. */ }
}

export function getDesktopCredential(username: string, timeoutMs = 1800): Promise<string | null> {
  const bridge = window.chrome?.webview
  if (!bridge) return Promise.resolve(null)
  return new Promise(resolve => {
    let settled = false
    const finish = (password: string | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      bridge.removeEventListener('message', listener)
      resolve(password)
    }
    const listener = (event: MessageEvent) => {
      const data = event.data as WebViewMessage | undefined
      if (data?.type !== 'credentialResult' || data.username?.toLowerCase() !== username.toLowerCase()) return
      finish(typeof data.password === 'string' && data.password.length > 0 ? data.password : null)
    }
    const timer = window.setTimeout(() => finish(null), timeoutMs)
    bridge.addEventListener('message', listener)
    try { bridge.postMessage({ type: 'getCredential', username } satisfies WebViewMessage) }
    catch { finish(null) }
  })
}
