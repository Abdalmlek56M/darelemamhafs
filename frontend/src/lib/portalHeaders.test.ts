import { describe, expect, it } from 'vitest'
import { portalRequestHeaders } from './portalHeaders'

describe('portalRequestHeaders', () => {
  it('marks teacher and supervisor routes', () => {
    expect(portalRequestHeaders('/teacher')).toEqual({ 'X-Dar-Portal': 'teacher' })
    expect(portalRequestHeaders('/teacher/history')).toEqual({ 'X-Dar-Portal': 'teacher' })
    expect(portalRequestHeaders('/supervisor')).toEqual({ 'X-Dar-Portal': 'teacher' })
    expect(portalRequestHeaders('/supervisor/live')).toEqual({ 'X-Dar-Portal': 'teacher' })
  })

  it('does not mark admin or home routes', () => {
    expect(portalRequestHeaders('/')).toEqual({})
    expect(portalRequestHeaders('/management')).toEqual({})
    expect(portalRequestHeaders('/students')).toEqual({})
  })
})
