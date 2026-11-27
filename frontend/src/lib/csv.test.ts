import { describe, expect, it } from 'vitest'
import { escapeCsvCell, toCsvText } from './csv'

const dangerousPrefixes = ['=', '+', '-', '@', '\t', '\r']

describe('escapeCsvCell (CSV injection / formula injection)', () => {
  it('prefixes a single quote to every cell that starts with a formula character', () => {
    for (const prefix of dangerousPrefixes) {
      const cell = `${prefix}SUM(A1:A2)`
      expect(escapeCsvCell(cell)).toBe(`"'${cell}"`)
    }
  })

  it('neutralizes realistic Excel/DDE payloads', () => {
    expect(escapeCsvCell('=HYPERLINK("http://evil.example","click")')).toBe(
      `"'=HYPERLINK(""http://evil.example"",""click"")"`,
    )
    expect(escapeCsvCell('@SUM(1+1)*cmd|\' /C calc\'!A0')).toBe(`"'@SUM(1+1)*cmd|' /C calc'!A0"`)
    expect(escapeCsvCell('-2+3+cmd|\' /C calc\'!A0')).toBe(`"'-2+3+cmd|' /C calc'!A0"`)
    expect(escapeCsvCell('+1')).toBe(`"'+1"`)
  })

  it('keeps leading/trailing spaces and Arabic text untouched (only the first character matters)', () => {
    expect(escapeCsvCell('مريم أحمد')).toBe('"مريم أحمد"')
    expect(escapeCsvCell('  =SUM(A1)')).toBe('"  =SUM(A1)"')
    expect(escapeCsvCell('a=b')).toBe('"a=b"')
  })

  it('does not prefix numeric cells that do not start with a formula character', () => {
    expect(escapeCsvCell(1234.5)).toBe('"1234.5"')
    expect(escapeCsvCell(0)).toBe('"0"')
    // Negative numbers are text in CSV and must be neutralized per the rule.
    expect(escapeCsvCell(-350)).toBe(`"'-350"`)
  })

  it('handles empty cells and escaped quotes', () => {
    expect(escapeCsvCell(null)).toBe('""')
    expect(escapeCsvCell(undefined)).toBe('""')
    expect(escapeCsvCell('')).toBe('""')
    expect(escapeCsvCell('he said "hi"')).toBe('"he said ""hi"""')
  })
})

describe('toCsvText', () => {
  it('emits a UTF-8 BOM, quoted cells and CRLF rows', () => {
    expect(toCsvText([['الطالب', 'المتبقي'], ['مريم', 150]])).toBe('\ufeff"الطالب","المتبقي"\r\n"مريم","150"')
  })

  it('escapes injection payloads inside data rows', () => {
    const csv = toCsvText([['الطالب'], ['=cmd|\' /C calc\'!A0']])
    expect(csv).toContain(`"'=cmd|' /C calc'!A0"`)
  })
})
