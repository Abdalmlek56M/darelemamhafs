import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearDemoState, DEMO_STORAGE_KEY, demoModeAllowed, readDemoMode, storeDemoMode } from './demoMode'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => { data[key] = value },
    removeItem: (key: string) => { delete data[key] },
  }
}

afterEach(() => vi.unstubAllEnvs())

describe('demo mode production gating', () => {
  it('is disabled in production builds', () => {
    expect(demoModeAllowed({ PROD: true })).toBe(false)
    expect(demoModeAllowed({ PROD: 'true' })).toBe(false)
    expect(demoModeAllowed({ PROD: true, VITE_ENABLE_DEMO: '0' })).toBe(false)
    expect(demoModeAllowed({ PROD: true, VITE_ENABLE_DEMO: 'true' })).toBe(false)
  })

  it('allows an explicit test/QA flag even in production', () => {
    expect(demoModeAllowed({ PROD: true, VITE_ENABLE_DEMO: '1' })).toBe(true)
  })

  it('is available in development and test builds', () => {
    expect(demoModeAllowed({ PROD: false })).toBe(true)
    expect(demoModeAllowed({})).toBe(true)
  })

  it('ignores ?demo=1 and a stored preference when the build forbids demo mode', () => {
    expect(readDemoMode('?demo=1', memoryStorage(), false)).toBe(false)
    expect(readDemoMode('', memoryStorage({ [DEMO_STORAGE_KEY]: '1' }), false)).toBe(false)
    expect(readDemoMode('?demo=1', memoryStorage({ [DEMO_STORAGE_KEY]: '1' }), true)).toBe(true)
  })
})

describe('demo mode storage lifecycle', () => {
  it('restores the tab preference from sessionStorage and the URL flag', () => {
    expect(readDemoMode('', memoryStorage({ [DEMO_STORAGE_KEY]: '1' }), true)).toBe(true)
    expect(readDemoMode('', memoryStorage({ [DEMO_STORAGE_KEY]: '0' }), true)).toBe(false)
    expect(readDemoMode('?demo=1', memoryStorage(), true)).toBe(true)
    expect(readDemoMode('?demo=0', memoryStorage(), true)).toBe(false)
  })

  it('stores the preference and clears both the session and the legacy localStorage keys', () => {
    const session = memoryStorage()
    const legacy = memoryStorage({ [DEMO_STORAGE_KEY]: '1' })
    storeDemoMode(true, session)
    expect(session.data[DEMO_STORAGE_KEY]).toBe('1')
    storeDemoMode(false, session)
    expect(session.data[DEMO_STORAGE_KEY]).toBe('0')
    clearDemoState(session, legacy)
    expect(session.data[DEMO_STORAGE_KEY]).toBeUndefined()
    expect(legacy.data[DEMO_STORAGE_KEY]).toBeUndefined()
  })
})
