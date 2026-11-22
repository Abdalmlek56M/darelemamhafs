import { useEffect, useId, useRef, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'

type ModalProps = {
  title: string
  subtitle?: string
  wide?: boolean
  level?: number
  close: () => void
  children: ReactNode
}

function focusableIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
    .filter((element) => element.getClientRects().length > 0)
}

/**
 * Accessible dialog: works as a centered modal on desktop and as a bottom sheet on
 * phones (styling lives in styles/foundation.css). Handles Escape, focus trap,
 * background scroll lock and the on-screen keyboard (visualViewport) height.
 */
function Modal({ title, subtitle, wide = false, level = 0, close, children }: ModalProps) {
  const brandName = localStorage.getItem('dar-brand-name') || 'دار الإمام حفص للقرآن والتجويد'
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.classList.add('modal-open')

    const updateViewportHeight = () => {
      const height = window.visualViewport?.height ?? window.innerHeight
      document.documentElement.style.setProperty('--app-vvh', Math.round(height) + 'px')
    }
    updateViewportHeight()
    window.visualViewport?.addEventListener('resize', updateViewportHeight)
    window.visualViewport?.addEventListener('scroll', updateViewportHeight)
    window.addEventListener('resize', updateViewportHeight)

    const container = dialogRef.current
    const preferredField = container?.querySelector<HTMLElement>('input:not([disabled]),select:not([disabled]),textarea:not([disabled])')
    const firstFocusable = focusableIn(container)[0]
    ;(preferredField ?? firstFocusable ?? closeButtonRef.current)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const list = focusableIn(container)
      if (list.length === 0) return
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !container?.contains(active))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.classList.remove('modal-open')
      window.visualViewport?.removeEventListener('resize', updateViewportHeight)
      window.visualViewport?.removeEventListener('scroll', updateViewportHeight)
      window.removeEventListener('resize', updateViewportHeight)
      document.documentElement.style.removeProperty('--app-vvh')
      const opener = openerRef.current
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  return <motion.div style={{ zIndex: 50 + level * 10 }} className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <motion.div ref={dialogRef} className={'student-modal glass ' + (wide ? 'modal-wide' : '')} role="dialog" aria-modal="true" aria-labelledby={titleId} initial={{ opacity: 0, y: 15, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }}>
      <div className="modal-heading">
        <div><span className="eyebrow">{brandName}</span><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button ref={closeButtonRef} type="button" className="small-icon-button close-modal" onClick={close} aria-label="إغلاق"><X size={18} /></button>
      </div>
      {children}
    </motion.div>
  </motion.div>
}

export default Modal
