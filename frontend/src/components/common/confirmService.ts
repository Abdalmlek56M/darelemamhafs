export type ConfirmOptions = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type PendingConfirm = { options: ConfirmOptions; resolve: (confirmed: boolean) => void }

let pending: PendingConfirm | null = null
let notify: ((next: PendingConfirm | null) => void) | null = null

/** Called once by <ConfirmSheetHost /> (mounted from ApplicationDialogs). */
export function subscribeConfirm(listener: ((next: PendingConfirm | null) => void) | null) {
  notify = listener
  return () => { if (notify === listener) notify = null }
}

function settle(confirmed: boolean) {
  const current = pending
  pending = null
  notify?.(null)
  current?.resolve(confirmed)
}

/** Promise-based confirmation sheet; falls back to window.confirm only if the host is not mounted. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  if (!notify) {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') return Promise.resolve(window.confirm(options.message))
    return Promise.resolve(false)
  }
  // A second confirmation while one is pending cancels the older one instead of stacking sheets.
  if (pending) settle(false)
  return new Promise<boolean>((resolve) => {
    pending = { options, resolve }
    notify?.(pending)
  })
}

export function resolveConfirm(confirmed: boolean) { settle(confirmed) }

export function currentConfirm(): ConfirmOptions | null { return pending?.options ?? null }
