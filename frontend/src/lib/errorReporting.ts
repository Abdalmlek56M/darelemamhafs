export type UiErrorScope = 'app' | 'page' | 'dialog' | 'global'

export type UiErrorContext = {
  scope: UiErrorScope
  page: string
  componentStack?: string | null
}

/**
 * Structured UI error log: scope, page name and component stack only.
 * Never logs error.message, form values, usernames, phone numbers or passwords.
 *
 * SENTRY-HOOK: later, call Sentry.captureException here with the same tags.
 * Sentry is intentionally not installed or enabled in P2-9.
 */
export function reportUiError(context: UiErrorContext): void {
  console.error('[DAR_UI_ERROR]', {
    scope: context.scope,
    page: context.page || 'unknown',
    componentStack: context.componentStack || '',
  })
}
