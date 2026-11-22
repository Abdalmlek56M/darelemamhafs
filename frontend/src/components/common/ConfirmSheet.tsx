import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import Modal from './Modal'
import ModalActions from './ModalActions'
import { confirmAction, currentConfirm, resolveConfirm, subscribeConfirm, type ConfirmOptions } from './confirmService'

/**
 * Renders the single pending confirmation as an accessible sheet. Mounted once
 * from ApplicationDialogs so any page or hook can await confirmAction({...}).
 */
export default function ConfirmSheetHost() {
  const [options, setOptions] = useState<ConfirmOptions | null>(() => currentConfirm())

  useEffect(() => subscribeConfirm((next) => setOptions(next?.options ?? null)), [])

  useEffect(() => {
    if (!options) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); resolveConfirm(false) } }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [options])

  if (!options) return null

  return <AnimatePresence>
    <Modal title={options.title} close={() => resolveConfirm(false)}>
      <p className="confirm-sheet-message">{options.message}</p>
      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={() => resolveConfirm(false)}>{options.cancelLabel ?? 'إلغاء'}</button>
        <button type="button" className={'primary-button ' + (options.danger ? 'danger-primary' : '')} onClick={() => resolveConfirm(true)}>{options.confirmLabel ?? 'تأكيد'}</button>
      </div>
    </Modal>
  </AnimatePresence>
}

export { confirmAction }
