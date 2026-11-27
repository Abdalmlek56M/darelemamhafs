// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import useDarApplication from './useDarApplication'

// Z1: Testing Library/jsdom characterization of the admin application hook before/after
// the remaining file split.
beforeAll(() => {
  localStorage.clear()
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'offline' }), { status: 503, headers: { 'content-type': 'application/json' } })))
})

describe('useDarApplication with Testing Library', () => {
  it('starts in the checking gate and exposes the context contract', () => {
    const { result } = renderHook(() => useDarApplication())
    expect(result.current.gate).toBe('checking')
    for (const key of ['theme', 'setTheme', 'branding', 'session', 'page', 'toast', 'has', 'visiblePages', 'saveStudent', 'savePayment']) {
      expect(result.current).toHaveProperty(key)
    }
  })
})
