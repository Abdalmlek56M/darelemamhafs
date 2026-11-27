// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import TeacherApp from './TeacherApp'

// Z1: Testing Library/jsdom characterization of the teacher shell before/after its split.
beforeAll(() => {
  localStorage.clear()
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'offline' }), { status: 503, headers: { 'content-type': 'application/json' } })))
})

describe('TeacherApp with Testing Library', () => {
  it('renders the checking shell for an unauthenticated visitor', () => {
    render(<TeacherApp mode="teacher" />)
    expect(screen.getByText('جارٍ التحقق من الجلسة…')).toBeTruthy()
    expect(document.querySelector('.teacher-app')).toBeTruthy()
  })
})
