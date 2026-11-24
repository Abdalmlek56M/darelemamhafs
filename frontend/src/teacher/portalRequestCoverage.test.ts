import { describe, expect, it } from 'vitest'
import swSource from '../../public/sw.js?raw'
import apiSource from './teacherApi.ts?raw'
import outboxSource from './useTeacherOutbox.ts?raw'

describe('teacher portal request coverage', () => {
  it('the service worker never intercepts /api/ requests', () => {
    // API requests bypass the SW entirely, so they always go through teacherApi's header.
    expect(swSource).toContain("url.pathname.startsWith('/api/')")
    expect(swSource).toContain('return;')
  })

  it('the outbox sends through teacherApi and has no direct fetch', () => {
    expect(outboxSource).toContain('teacherApi.submit')
    expect(outboxSource).not.toContain('fetch(')
  })

  it('teacherApi applies the portal header centrally', () => {
    expect(apiSource).toContain("headers.set('X-Dar-Portal', 'teacher')")
  })
})
