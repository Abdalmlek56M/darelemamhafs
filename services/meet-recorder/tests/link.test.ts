import { describe, expect, it } from 'vitest'
import { isAllowedMeetHost, validateMeetLink } from '../src/meet/link.js'

describe('meet link validation (FINAL 1.18)', () => {
  it('accepts only https Google Meet hosts', () => {
    expect(validateMeetLink('https://meet.google.com/abc-defg-hij')).toEqual({ ok: true, url: 'https://meet.google.com/abc-defg-hij' })
    expect(validateMeetLink('https://meet.google.com/abc-defg-hij?authuser=0').ok).toBe(true)
  })

  it('rejects missing, malformed and non-Meet links before the browser starts', () => {
    expect(validateMeetLink(null)).toEqual({ ok: false, reason: 'missing' })
    expect(validateMeetLink('   ')).toEqual({ ok: false, reason: 'missing' })
    expect(validateMeetLink('not a url')).toEqual({ ok: false, reason: 'invalid' })
    expect(validateMeetLink('http://meet.google.com/abc')).toEqual({ ok: false, reason: 'invalid' })
    expect(validateMeetLink('https://example.com/abc-defg-hij')).toEqual({ ok: false, reason: 'unsupported_host' })
    expect(validateMeetLink('https://meet.google.com.evil.example/abc')).toEqual({ ok: false, reason: 'unsupported_host' })
    expect(validateMeetLink('https://meet.google.com/')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('host check is exact', () => {
    expect(isAllowedMeetHost('https://meet.google.com/x')).toBe(true)
    expect(isAllowedMeetHost('https://clients6.google.com/x')).toBe(false)
  })
})
