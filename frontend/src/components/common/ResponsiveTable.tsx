import type { ReactNode } from 'react'

export type ResponsiveColumn<Row> = {
  key: string
  header: ReactNode
  render: (row: Row) => ReactNode
  /** Optional CSS class added to both the desktop cell and the mobile value. */
  className?: string
  /** Force LTR isolation (phones, codes, numbers inside an RTL page). */
  ltr?: boolean
  /** The column rendered as the mobile card title (defaults to the first column). */
  primary?: boolean
}

type Props<Row> = {
  rows: Row[]
  columns: ResponsiveColumn<Row>[]
  rowKey: (row: Row) => string
  actions?: (row: Row) => ReactNode
  actionsHeader?: string
  caption: string
  tableClassName?: string
  empty?: ReactNode
  loading?: boolean
  loadingRows?: number
  className?: string
}

/**
 * One table for desktop and one card list for phones from the same data.
 * >=768px renders the existing table markup; <768px renders one card per row
 * with every column as a labelled value plus the row actions.
 */
export default function ResponsiveTable<Row>({
  rows, columns, rowKey, actions, actionsHeader = 'الإجراءات', caption,
  tableClassName = 'students-table wide-table', empty, loading = false, loadingRows = 6, className = '',
}: Props<Row>) {
  const primaryIndex = Math.max(0, columns.findIndex((column) => column.primary))
  const colSpan = columns.length + (actions ? 1 : 0)

  const skeletonRows = Array.from({ length: loadingRows }, (_, rowIndex) => rowIndex)

  return <>
    {loading && rows.length === 0 && (
      <div className="rt-loading" role="status" aria-live="polite">
        <span className="rt-skeleton rt-skeleton-head" />
        {skeletonRows.map((index) => <span key={index} className="rt-skeleton" />)}
        <span className="sr-only">جارٍ تحميل البيانات…</span>
      </div>
    )}

    <div className={'rt-desktop table-scroll ' + className}>
      <table className={tableClassName}>
        <caption className="sr-only">{caption}</caption>
        <thead><tr>
          {columns.map((column) => <th key={column.key} scope="col" className={column.className}>{column.header}</th>)}
          {actions && <th scope="col" className="rt-actions-head">{actionsHeader}</th>}
        </tr></thead>
        <tbody>
          {!loading && rows.map((row) => <tr key={rowKey(row)}>
            {columns.map((column) => <td key={column.key} className={column.className} dir={column.ltr ? 'ltr' : undefined}>{column.render(row)}</td>)}
            {actions && <td className="rt-actions-cell"><div className="row-actions">{actions(row)}</div></td>}
          </tr>)}
          {!loading && rows.length === 0 && <tr><td colSpan={colSpan}>{empty}</td></tr>}
        </tbody>
      </table>
    </div>

    <div className="rt-cards" role="list" aria-label={caption}>
      {!loading && rows.map((row) => <div key={rowKey(row)} className="rt-card" role="listitem">
        {columns.map((column, index) => index === primaryIndex
          ? <div key={column.key} className="rt-card-title">{column.render(row)}</div>
          : <div key={column.key} className="rt-card-row">
            <span className="rt-card-label">{column.header}</span>
            <span className={'rt-card-value ' + (column.className ?? '')} dir={column.ltr ? 'ltr' : undefined}>{column.render(row)}</span>
          </div>)}
        {actions && <div className="rt-card-actions"><div className="row-actions">{actions(row)}</div></div>}
      </div>)}
      {!loading && rows.length === 0 && <div className="rt-card-empty">{empty}</div>}
    </div>
  </>
}
