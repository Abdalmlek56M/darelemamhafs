import { describe, expect, it } from 'vitest'
import { fromMinorUnits, parseMoneyInput, sumMoney, toMinorUnits } from './money'

describe('money helpers', () => {
  it('round-trips money through integer minor units', () => {
    expect(toMinorUnits(0.1) + toMinorUnits(0.2)).toBe(30)
    expect(fromMinorUnits(30)).toBe(0.3)
    expect(sumMoney([0.1, 0.2, 0.05])).toBe(0.35)
  })

  it('rejects non-finite, negative and zero amounts when zero is not allowed', () => {
    expect(parseMoneyInput('abc').ok).toBe(false)
    expect(parseMoneyInput('-1').ok).toBe(false)
    expect(parseMoneyInput('0').ok).toBe(false)
    expect(parseMoneyInput('0', { allowZero: true })).toEqual({ ok: true, value: 0 })
  })

  it('rejects more than two decimal places and accepts a normalized value', () => {
    expect(parseMoneyInput('10.999').ok).toBe(false)
    expect(parseMoneyInput(' 10.50 ')).toEqual({ ok: true, value: 10.5 })
  })
})
