/**
 * One app-level hook for expired sessions. The API client calls
 * `notifySessionExpired()` on any 401; the authenticated app registers a listener
 * that clears client state and returns to the login screen.
 */
type SessionExpiryListener = () => void

let listener: SessionExpiryListener | null = null

export function setSessionExpiryListener(next: SessionExpiryListener | null) {
  listener = next
}

export function notifySessionExpired() {
  if (!listener) return
  try { listener() } catch { /* never break the request pipeline because of the logout hook */ }
}
