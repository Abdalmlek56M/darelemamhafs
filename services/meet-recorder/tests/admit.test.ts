import { describe, expect, it } from 'vitest'
import { isAdmitControlLabel } from '../src/meet/access.js'

describe('auto-admit controls (FINAL 1.22)', () => {
  it('only accepts a complete admit label', () => {
    expect(isAdmitControlLabel('Admit')).toBe(true)
    expect(isAdmitControlLabel('admit all')).toBe(true)
    expect(isAdmitControlLabel('Let them in')).toBe(true)
    expect(isAdmitControlLabel('Admit the teacher')).toBe(false)
    expect(isAdmitControlLabel('Remove participant')).toBe(false)
  })
})
