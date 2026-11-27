/**
 * CSV export helper with spreadsheet-formula-injection protection.
 *
 * Excel/LibreOffice/Google Sheets treat a cell that starts with `=`, `+`, `-`,
 * `@`, TAB or CR as a formula (CSV injection / DDE). Every exported cell is
 * therefore quoted and such cells get a leading single quote so they are
 * imported as inert text.
 */
const FORMULA_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r'])

export function escapeCsvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value)
  const guarded = text.length > 0 && FORMULA_PREFIXES.has(text[0]) ? `'${text}` : text
  return `"${guarded.replaceAll('"', '""')}"`
}

/** Build a CSV document (UTF-8 BOM + CRLF rows) from raw cells. */
export function toCsvText(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>, eol = '\r\n'): string {
  return '\ufeff' + rows.map(row => row.map(escapeCsvCell).join(',')).join(eol)
}
