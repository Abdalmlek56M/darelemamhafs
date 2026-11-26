type Props = {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  buttonClassName?: string
  label?: string
}

/** Shared RTL pager: previous/next with an aria-live summary. Hidden for a single page. */
export default function Pager({ page, pageSize, total, onPageChange, buttonClassName = 'secondary-button', label = 'سجل' }: Props) {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
  if (pages <= 1) return null
  const safePage = Math.min(Math.max(1, page), pages)
  return (
    <div
      className="pager"
      role="group"
      aria-label="التنقل بين الصفحات"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '12px 2px' }}
    >
      <button
        type="button"
        className={buttonClassName}
        onClick={() => onPageChange(safePage - 1)}
        disabled={safePage <= 1}
        aria-label="الصفحة السابقة"
      >السابق</button>
      <span style={{ color: 'var(--muted)', fontSize: 12 }} aria-live="polite">
        صفحة {safePage} من {pages} · {total} {label}
      </span>
      <button
        type="button"
        className={buttonClassName}
        onClick={() => onPageChange(safePage + 1)}
        disabled={safePage >= pages}
        aria-label="الصفحة التالية"
      >التالي</button>
    </div>
  )
}
