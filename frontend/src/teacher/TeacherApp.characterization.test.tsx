import { beforeAll, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import TeacherApp from './TeacherApp'

// Z1 characterization: TeacherApp's unauthenticated server render is stable while the
// component is split into subcomponents.
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined },
  })
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  })
  if (!globalThis.fetch) {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async () => new Response(JSON.stringify({ message: 'offline' }), { status: 503 }),
    })
  }
})

describe('TeacherApp characterization (Z1)', () => {
  it('renders the login shell for an unauthenticated visitor', () => {
    const markup = renderToStaticMarkup(createElement(TeacherApp, { mode: 'teacher' }))
    expect(markup).toBe('<div class="teacher-app"><div class="t-empty">جارٍ التحقق من الجلسة…</div></div>')
  })
})
