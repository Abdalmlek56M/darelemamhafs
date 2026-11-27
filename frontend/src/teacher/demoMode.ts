/**
 * Supervisor demo-mode gating and storage.
 *
 * The demo dataset is a preview/QA aid only: it must never be reachable in a
 * production build unless a test/QA deployment explicitly opts in with
 * `VITE_ENABLE_DEMO=1`. The preference is stored in sessionStorage (per tab) and
 * the legacy localStorage key is always cleaned up; logging out clears it.
 */
export const DEMO_STORAGE_KEY = 'dar-supervisor-demo'

export type DemoEnv = { PROD?: boolean | string; VITE_ENABLE_DEMO?: string }

/** Production disables demo mode unless the explicit test/QA flag is set. */
export function demoModeAllowed(env: DemoEnv): boolean {
  // Vite exposes PROD as a boolean; tests may stub it as the string 'true'.
  const isProduction = env.PROD === true || env.PROD === 'true'
  return !isProduction || env.VITE_ENABLE_DEMO === '1'
}

export function isDemoModeAllowed(): boolean {
  return demoModeAllowed(import.meta.env)
}

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem' | 'removeItem'>

/** Read the demo preference for this tab: `?demo=1` wins, then sessionStorage. */
export function readDemoMode(search: string, storage: ReadableStorage, allowed = isDemoModeAllowed()): boolean {
  if (!allowed) return false
  try {
    if (new URLSearchParams(search).get('demo') === '1') return true
    return storage.getItem(DEMO_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Persist the demo preference for this tab only (older builds used localStorage). */
export function storeDemoMode(enabled: boolean, storage: WritableStorage): void {
  try {
    storage.setItem(DEMO_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    /* demo preference is optional */
  }
}

/** Remove every demo-mode trace (session + legacy localStorage) — used on logout. */
export function clearDemoState(session: WritableStorage, legacy: Pick<Storage, 'removeItem'>): void {
  try { session.removeItem(DEMO_STORAGE_KEY) } catch { /* ignore unavailable storage */ }
  try { legacy.removeItem(DEMO_STORAGE_KEY) } catch { /* ignore unavailable storage */ }
}
