import { useEffect, useRef } from 'react'

type Props = {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function RoomConfirmDialog({
  title, message, confirmLabel, cancelLabel = 'إلغاء', onConfirm, onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="room-sheet-backdrop room-dialog-backdrop" onClick={onCancel}>
      <div
        className="room-confirm-dialog glass"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="room-confirm-title"
        aria-describedby="room-confirm-message"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="room-confirm-title">{title}</h2>
        <p id="room-confirm-message">{message}</p>
        <div className="room-confirm-actions">
          <button type="button" ref={cancelRef} className="secondary-button" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="room-end-btn is-solid" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
