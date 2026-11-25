type Props = {
  onRetry: () => void
  onHome: () => void
  fullPage?: boolean
  compact?: boolean
}

/** Arabic-only fallback. Never renders error messages or stack traces. */
export default function ErrorFallback({ onRetry, onHome, fullPage = false, compact = false }: Props) {
  return (
    <div role="alert" style={{ minHeight: fullPage ? '100vh' : compact ? 0 : '55vh', display: 'grid', placeItems: 'center', padding: compact ? 16 : 24, textAlign: 'center', fontFamily: 'inherit', background: fullPage ? 'var(--page-bg, #080e19)' : undefined }}>
      <div style={{ maxWidth: 440, width: '100%', padding: compact ? 16 : 24, borderRadius: 18, border: '1px solid var(--line, #2b3a50)', background: 'var(--surface, #111b2c)', color: 'var(--text, #e9eef6)' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: compact ? 17 : 21 }}>تعذر عرض هذه الصفحة</h2>
        <p style={{ margin: '0 0 16px', color: 'var(--muted, #95a4ba)', lineHeight: 1.8 }}>حدث خطأ غير متوقع. جرّب مرة أخرى أو ارجع للرئيسية.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="primary-button" onClick={onRetry}>إعادة المحاولة</button>
          <button type="button" className="secondary-button" onClick={onHome}>العودة للرئيسية</button>
        </div>
      </div>
    </div>
  )
}
