export type MoneyParseResult = { ok: true; value: number } | { ok: false; error: string }

/** Money travels as integer minor units to avoid binary floating-point drift. */
export function toMinorUnits(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error('المبلغ ليس رقمًا صحيحًا.')
  return Math.round(amount * 100)
}

export function fromMinorUnits(units: number): number {
  return units / 100
}

export function sumMoney(values: number[]): number {
  return fromMinorUnits(values.reduce((sum, value) => sum + toMinorUnits(value), 0))
}

export type MoneyInputOptions = { allowZero?: boolean; max?: number }

/** Single parser for every money input: finite, non-negative, max two decimals. */
export function parseMoneyInput(raw: string, options: MoneyInputOptions = {}): MoneyParseResult {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, error: 'اكتب المبلغ.' }
  const value = Number(text)
  if (!Number.isFinite(value)) return { ok: false, error: 'اكتب مبلغًا صحيحًا.' }
  if (value < 0) return { ok: false, error: 'المبلغ لا يكون سالبًا.' }
  if (value === 0 && !options.allowZero) return { ok: false, error: 'اكتب مبلغًا أكبر من صفر.' }
  if (options.max != null && value > options.max) return { ok: false, error: 'المبلغ أكبر من الحد المسموح.' }
  const cents = Math.round(value * 100)
  if (Math.abs(cents / 100 - value) > 1e-9) return { ok: false, error: 'اكتب منزلتين عشريتين كحد أقصى.' }
  return { ok: true, value: cents / 100 }
}
