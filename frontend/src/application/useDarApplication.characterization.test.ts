import { beforeAll, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import useDarApplication from './useDarApplication'

// Z1 characterization: the admin application hook's initial contract (keys + render)
// must be unchanged by the later file split.
const store = new Map<string, string>()

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    },
  })
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  })
})

function Probe() {
  const ctx = useDarApplication()
  ;(globalThis as unknown as { __darKeys: string[] }).__darKeys = Object.keys(ctx).sort()
  return createElement('div', null, 'probe')
}

describe('useDarApplication characterization (Z1)', () => {
  it('renders and exposes the stable context contract', () => {
    expect(() => renderToStaticMarkup(createElement(Probe))).not.toThrow()
    const keys = (globalThis as unknown as { __darKeys?: string[] }).__darKeys ?? []
    const required = [
      'session', 'gate', 'page', 'branding', 'toast', 'theme', 'students', 'teachers', 'circles',
      'collections', 'dashboardProfit', 'teacherPaySummary', 'circleProfitSummary',
      'login', 'logout', 'saveStudent', 'saveTeacher', 'saveCircle', 'savePayment',
    ]
    for (const key of required) expect(keys).toContain(key)
  })
})
